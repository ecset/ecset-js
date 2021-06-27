import Jsonpointer from 'jsonpointer';
import { Entity, EntityId, getEntityId, isEntity } from '../../entity';
import { toComponentId, getComponentDefId, getComponentEntityId, getComponentId } from '../../component';
import { createLog } from '../../util/log';
import { isRegex, isInteger, isString, isBoolean, isDate, isValidDate } from '@odgn/utils';
import {
    BitField,
    create as createBitField,
    get as bfGet,
    set as bfSet,
    count as bfCount,
    and as bfAnd,
    or as bfOr,
    not as bfNot,
    typeFn as bfTypeFn,
    toValues as bfToValues,
    toString as bfToString,
    TYPE_AND,
    TYPE_OR,
    TYPE_NOT,
    isBitField,
} from '@odgn/utils/bitfield';
import { isStackValue, entityIdFromValue, QueryStack } from '../../query/stack';
import { SType, StackValue, InstResult, AsyncInstResult, StackError } from '../../query/types';
import { onPluck } from '../../query/words/pluck';
import { onDefine } from '../../query/words/define';
import { ComponentDefId, getDefId, ComponentDef, getProperty, PropertyType } from '../../component_def';
import { onLogicalFilter, parseFilterQuery } from './filter';
import { unpackStackValue, unpackStackValueR, stackToString } from '../../query/util';
import { EntitySetMem } from '../';
import { compareDates } from '../../query/words/util';
import { onBitFieldNot, onBitFieldOr, onPrintStack } from '../../query/words';
import { onDiff } from '../../query/words/list';
import { EntitySet, EntitySetOptions } from '../../entity_set';
import { QueryableEntitySet, SelectOptions } from '../../entity_set/queryable';
import { query, createStdLibStack, QueryOptions, Statement } from '../../query';

const Log = createLog('ESMemQuery');

class ESMemQueryStack extends QueryStack {
    es: EntitySetMem;
}

export interface QueryableEntitySetMem extends QueryableEntitySet, EntitySetMem {}

export class QueryableEntitySetMem extends EntitySetMem {
    stack: QueryStack;

    /**
     *
     * @param stack
     * @param query
     * @returns
     */
    select(stack: QueryStack, query: StackValue[], options: SelectOptions): Promise<StackValue[]> {
        stack.es = this as unknown as EntitySet;
        return select(stack, query, options);
    }

    /**
     *
     * @param q
     * @param options
     */
    prepare(q: string, options: QueryOptions = {}) {
        const stmt = new Statement(q, { ...options, values: [[SType.EntitySet, this]] });
        stmt.stack.addWords([['!es', onEntitySet, SType.Map]]);
        return stmt;
    }

    /**
     *
     * @param q
     * @param options
     */
    async query(q: string, options: QueryOptions = {}): Promise<QueryStack> {
        const reset = options.reset ?? false;
        let values: StackValue[] = options.values ?? [];
        if (this.stack === undefined || reset) {
            this.stack = createStdLibStack();
            this.stack.addWords([['!es', onEntitySet, SType.Map]]);
        }

        values = [[SType.Value, 'cls'], [SType.EntitySet, this], ...values];

        return await query(q, { stack: this.stack, values });
    }

    /**
     * Returns the results of a query as an array of entities
     *
     * @param q
     * @param options
     */
    async queryEntities(q: string, options: QueryOptions = {}): Promise<Entity[]> {
        const stack = await this.query(q, options);
        const value = stack.pop();
        const result: Entity[] = [];
        if (value === undefined) {
            return result;
        }

        const [type, val] = value;
        if (type === SType.List) {
            let e: Entity;
            for (const [lt, lv] of val) {
                if (lt === SType.Entity) {
                    result.push(lv);
                } else if (lt === SType.Component) {
                    const eid = getComponentEntityId(lv);

                    if (e === undefined || e.id !== eid) {
                        if (e !== undefined) {
                            result.push(e);
                        }
                        e = this.createEntity(eid);
                    }
                    e.addComponentUnsafe(lv);
                }
            }
            if (e !== undefined) {
                result.push(e);
            }
        } else if (type === SType.Component) {
            const eid = getComponentEntityId(val);
            const e = this.createEntity(eid);
            e.addComponentUnsafe(val);
            result.push(e);
        } else if (type == SType.Entity) {
            result.push(val);
        }

        return result;
    }
}

function onEntitySet<QS extends QueryStack>(stack: QS): InstResult {
    const data = stack.pop();

    const options = unpackStackValueR(data, SType.Map);
    const es = new EntitySetMem(options);

    return [SType.EntitySet, es];
}

/**
 *
 * @param es
 * @param query
 */
export async function select(
    stack: QueryStack,
    query: StackValue[],
    options: SelectOptions = {},
): Promise<StackValue[]> {
    stack.setChild();

    // add first pass words
    stack.addWords([
        ['!bf', buildBitfield, SType.List],
        ['!bf', buildBitfield, SType.Value],
        ['!ca', onComponentAttr],
        ['define', onDefine],

        // converts a BitField to OR mode
        ['!or', onBitFieldOr, SType.BitField],
        ['!not', onBitFieldNot, SType.BitField],

        ['order', onOrder, SType.ComponentAttr, SType.Value],
        ['limit', applyLimit],

        ['and', onLogicalFilter, SType.Any, SType.Any],
        ['or', onLogicalFilter, SType.Any, SType.Any],
        ['not', onLogicalFilter, SType.Any, SType.Any],
        ['==', onLogicalFilter, SType.Any, SType.Any],
        ['!=', onLogicalFilter, SType.Any, SType.Any],
        ['>', onLogicalFilter, SType.Any, SType.Any],
        ['>=', onLogicalFilter, SType.Any, SType.Any],
        ['<', onLogicalFilter, SType.Any, SType.Any],
        ['<=', onLogicalFilter, SType.Any, SType.Any],
        ['prints', onPrintStack],
        [
            'debug',
            () => {
                stack.scratch.debug = true;
                return undefined;
            },
        ],
    ]);

    stack.scratch.orderBy = undefined;
    stack.scratch.limit = [0, Number.MAX_SAFE_INTEGER];
    stack.scratch.isCount = options.isCount ?? false;

    await stack.pushValues(query, { evalEscape: true });

    // reset stack items and words
    let items = stack.items;

    stack.clear(true, false, false);

    stack.addWords([
        ['@e', fetchEntity],
        ['@eid', fetchEntity],
        ['@c', fetchComponents],
        ['@cid', fetchComponents],
        ['@ca', fetchComponentAttributes],
        ['!fil', applyFilter, SType.Filter],

        ['pluck', onPluck],
        ['pluck!', onPluck],
        ['diff', onDiff],
        ['diff!', onDiff],
        ['intersect', onDiff],
        ['intersect!', onDiff],
        ['union', onDiff],
        ['union!', onDiff],
    ]);

    // make sure any filter values have a following cmd
    items = items.reduce((result, value, ii, items) => {
        result.push(value);
        if (value[0] === SType.Filter) {
            result.push('!fil');
        }
        return result;
    }, []);

    await stack.pushValues(items);

    const result = stack.items;
    stack.restoreParent();

    return result;
}

function readEntityIds(stack: ESMemQueryStack): EntityId[] {
    const { es } = stack;

    let eids: EntityId[];

    const bf = stack.popBitFieldOpt();

    if (bf === undefined) {
        const from = stack.peek();

        if (from === undefined) {
            // return matchEntities(es, undefined, undefined);
        } else {
            stack.pop();
            const [type, val] = from;
            if (type === SType.Entity) {
                return [unpackStackValueR(from)];
                // Log.debug('[fetchComponent]', 'fetching from entity', eids);
            } else if (type === SType.List) {
                return val
                    .map((it) => {
                        return isStackValue(it) ? getEntityId(it[1]) : isEntity(it) ? getEntityId(it) : undefined;
                    })
                    .filter(Boolean);
            } else if (type === SType.Value && (val === false || val === 0)) {
                return [];
            }
            // Log.debug('[readEntityIds]', from);
        }
    }

    // console.log('[readEntityIds]', from);
    eids = matchEntities(es, undefined, bf) as EntityId[];

    // Log.debug('[readEntityIds]', eids);

    // default to all of the entity ids
    return eids;
}

/**
 *
 * @param stack
 */
export function applyFilter(stack: ESMemQueryStack): InstResult {
    const debug = stack.scratch.debug ?? false;
    const { es } = stack;
    const [, filter] = stack.pop();

    // determine whether the previous stack argument can give us
    // a set of eids. if not, then the filter is applied to all the entities
    // in the es
    let eids = readEntityIds(stack);

    // DLog(stack._root, 'bugger', filter);
    // ilog(stack.peek());
    const result = parseFilterQuery(es, filter[0], filter[1], filter[2]);
    // if( debug ) Log.debug('[applyFilter]', result);
    // Log.debug('[applyFilter]', Array.from(es.entities.keys()) );
    if (debug) Log.debug('[applyFilter]', 'query', result);

    eids = walkFilterQuery(es, { debug }, eids, ...result).sort();
    // if( debug ) Log.debug('[applyFilter]', 'result eids', eids );
    // Log.debug('[applyFilter]', 'result' );
    // ilog( eids );

    return [SType.List, eids.map((eid) => [SType.Entity, eid])];
}

interface FilterOptions {
    debug?: boolean;
}

function walkFilterQuery(es: EntitySetMem, options: FilterOptions = {}, eids: EntityId[], cmd?: string, ...args) {
    // console.log('[walkFQ]', eids, cmd, args);
    if (cmd === 'and') {
        const left = walkFilterQuery(es, options, eids, ...args[0]);
        if (options.debug) console.log('[walkFQ]', 'left', cmd, args[0], '->', left);
        if (left === undefined || left.length === 0) {
            return left;
        }

        // if there are no results, then return
        const right = walkFilterQuery(es, options, left, ...args[1]);
        if (options.debug) console.log('[walkFQ]', 'right', cmd, args[1], '->', right);
        return right;
    } else if (cmd === 'or') {
        const left = walkFilterQuery(es, options, eids, ...args[0]);
        // console.log('[walkFQ]', 'left', cmd, args[0], '->', left);
        const right = walkFilterQuery(es, options, eids, ...args[1]);
        // console.log('[walkFQ]', 'right', cmd, eids, args[0], '->', right);

        // Log.debug('[applyFilter]', 'or', left, right );

        // merge the results and return
        return [...new Set([...left, ...right])];
    }

    switch (cmd) {
        case '==':
        case '!=':
        case '>':
        case '>=':
        case '<':
        case '<=':
            return walkFilterQueryCompare(es, options, eids, cmd, ...args);
        case 'dids':
            return applyFilterDefIds(es, options, eids, args[1]);
        default:
            console.log('[walkFQ]', `unhandled cmd '${cmd}'`);
            return eids;
    }
}

function applyFilterDefIds(es: EntitySetMem, options: FilterOptions = {}, eids: EntityId[], bf: BitField) {
    // console.log('[applyFilterDefIds]', eids, dids, bf );

    const feids = matchEntities(es, eids, bf);
    // console.log('[applyFilterDefIds]', feids );

    return feids;
}

function walkFilterQueryCompare(
    es: EntitySetMem,
    options: FilterOptions = {},
    eids: EntityId[],
    cmd?: string,
    ...args
) {
    const { def } = args[0];
    const did = getDefId(def);
    const [ptr, val] = args[1];
    const isJptr = ptr.startsWith('/');

    eids = matchEntities(es, eids, createBitField([did])) as EntityId[];
    // console.log('[walkFilterQueryCompare]', 'eids', eids, did);
    let out = [];
    for (const eid of eids) {
        const cid = toComponentId(eid, did);
        const com = es.components.get(cid);

        if (com === undefined) {
            continue;
        }

        // console.log('[walk]', cmd, cid);
        // console.log('[walk]', cmd, ptr, val, cid);// {}.toString.call(val) );
        // if( com === undefined ){
        //     console.log('[walkFilterQueryCompare]', eid, def);
        // }

        const ptrVal = isJptr ? Jsonpointer.get(com, ptr) : com[ptr];

        // if( com[key] === val )
        // Log.debug('[walkFQ]','==', eid, ptr, ptrVal, val );
        // Log.debug('[walkFQ]','==', key, val, com[key], com);
        // if the value is an array, we look whether it exists
        if (Array.isArray(val)) {
            const r = val.indexOf(ptrVal) !== -1;
            if (cmd === '==') {
                out = r ? [...out, eid] : out;
            } else if (cmd === '!=') {
                out = r ? out : [...out, eid];
            }
            // out = val.indexOf(ptrVal) !== -1 ? [...out, eid] : out;
            // Log.debug('[walkFQ]', cmd, ptrVal, val, val.indexOf(ptrVal) );
        }
        if (ptrVal === undefined) {
        } else if (isDate(val)) {
            const ptrDte = new Date(ptrVal);
            if (isValidDate(ptrDte)) {
                if (compareDates(cmd, ptrDte, val)) {
                    // console.log('[walk]', cmd, ptrVal, val );
                    out = [...out, eid];
                }
            }
        } else if (isRegex(val)) {
            // console.log('[walkFQC]', ptrVal, val, val.test(ptrVal) );
            out = val.test(ptrVal) ? [...out, eid] : out;
        } else {
            // otherwise a straight compare
            out = ptrVal === val ? [...out, eid] : out;
        }
    }
    return out;
}

export function onOrder(stack: ESMemQueryStack): InstResult {
    const order = stack.popValue();
    const [bf, attrPtr] = stack.popValue();

    // Log.debug('[onOrder]', order, attrPtr);
    const did = bfToValues(bf)[0];

    stack.scratch.orderBy = [order.toLowerCase(), did, attrPtr];

    return undefined;
}

export function applyLimit(stack: ESMemQueryStack): InstResult {
    const offset = stack.popValue();
    const limit = stack.popValue();

    stack.scratch.limit = [offset, limit];

    return undefined;
}

export function fetchValue(stack: ESMemQueryStack): InstResult {
    const arg: StackValue = stack.pop();
    const type = arg[0];
    let value;

    if (type === SType.List) {
        value = unpackStackValue(arg);
        value = value.map((v) => [SType.Value, v]);
        value = [SType.List, value];
    }

    return value;
}

/**
 * first argument indicates which components should be fetched
 * 2nd argument is a list of entity ids
 * @param stack
 */
export function fetchComponents(stack: ESMemQueryStack, [, op]: StackValue): InstResult {
    const { es } = stack;
    let left: StackValue;
    let eids: EntityId[];
    const isCount = stack.scratch.isCount ?? false;
    const returnCid = op === '@cid';

    let coms = [];

    // get the bitfield
    const bf = stack.popBitFieldOpt();

    // Log.debug('[fetchComponent]', 'bf', bf );

    left = stack.peek();

    // Log.debug('[fetchComponent]', 'peek', left);

    if (left !== undefined) {
        const from = stack.pop();
        // Log.debug('[fetchComponent]', 'arg', from);

        if (from[0] === SType.Entity) {
            eids = [unpackStackValueR(from)];
            // Log.debug('[fetchComponent]', 'fetching from entity', eids);
        } else if (from[0] === SType.List) {
            eids = from[1]
                .map((it) => {
                    return isStackValue(it) ? getEntityId(it[1]) : isEntity(it) ? getEntityId(it) : undefined;
                })
                .filter(Boolean);
            // Log.debug('[fetchComponent]', eids);
        } else {
            // Log.debug('[fetchComponent]', 'unhandled', from);
            return [SType.List, []];
        }
    }

    // Log.debug('[fetchComponent]', eids, bfToValues(bf));
    // Log.debug('[fetchComponent]', eids, bfToValues(bf), bf?.type );

    // if an empty eid array has been passed, then no coms can be selected
    if (eids !== undefined && eids.length === 0) {
        return isCount ? [SType.Value, coms.length] : [SType.List, coms];
    }

    let [orderDir, orderDid, orderAttr, orderType] = stack.scratch.orderBy ?? ['desc'];
    const [offset, limit] = stack.scratch.limit ?? [0, Number.MAX_SAFE_INTEGER];
    if (orderType === undefined) {
        orderType = 'integer';
    }
    let isPtr = false;

    if (orderDid !== undefined) {
        const def = es.getByDefId(orderDid);
        isPtr = orderAttr.startsWith('/');
        const prop = getProperty(def, isPtr ? orderAttr.substring(1) : orderAttr);
        if (prop === undefined) {
            console.log('[fetchComponent][orderBy]', 'could not find prop', orderAttr);
            orderDid = undefined;
        } else {
            orderType = prop.type;
        }
        // Log.debug('[fetchComponent]', 'orderBy', orderDid, orderAttr);
    }

    for (const [, com] of es.components) {
        const eid = getComponentEntityId(com);
        if (eids !== undefined && eids.length > 0) {
            if (eids.indexOf(eid) === -1) {
                continue;
            }
        }

        if (bf !== undefined && bf.isAllSet === false) {
            const cmpFn = bfTypeFn(bf);
            const ebf = es.entities.get(eid);
            if (cmpFn(bf, ebf) === false) {
                continue;
            }
            if (bfGet(bf, getComponentDefId(com)) === false) {
                continue;
            }
        }

        if (orderDid !== undefined) {
            const orderCom = es.components.get(toComponentId(eid, orderDid));
            if (orderCom !== undefined) {
                let val = isPtr ? Jsonpointer.get(orderCom, orderAttr) : orderCom[orderAttr];
                if (val !== undefined) {
                    val = isString(val) ? val.toLowerCase() : val;
                    if (orderType === 'datetime') {
                        val = new Date(val).getTime();
                    }
                    coms.push([com, val, orderType]);
                    continue;
                }
            }
        }
        // Log.debug('[fetchComponent]', eid, com);

        coms.push([com, eid, 'entity']);
    }

    if (isCount) {
        return [SType.Value, coms.length];
    }

    // sort
    coms.sort(([a, ac, at], [b, bc, bt]) => attrCompare(ac, bc, at, bt, orderDir));

    coms = coms.map(([com]) => {
        return returnCid ? [SType.Value, getComponentId(com)] : [SType.Component, com];
    });

    coms = coms.slice(offset, offset + limit);

    return [SType.List, coms]; //coms.map(c => [SType.Component, c])];
}

function attrCompare(a: any, b: any, aType: PropertyType, bType: PropertyType, orderDir: 'asc' | 'desc' = 'desc') {
    // console.log('[attrCompare]', a, b, aType, bType);
    let isDesc = orderDir === 'desc';
    if (aType === 'datetime') {
        isDesc = !isDesc;
    }
    if (aType !== bType) {
        return 0;
    }
    if (a < b) {
        return isDesc ? -1 : 1;
    }
    if (a > b) {
        return isDesc ? 1 : -1;
    }
    return 0;
}

export function fetchComponentAttributes(stack: ESMemQueryStack): InstResult {
    const { es } = stack;
    const result = [];

    // get the attribute
    let attr = stack.pop();

    // determine whether the previous stack argument can give us
    // a set of eids. if not, then the filter is applied to all the entities
    // in the es
    const eids = readEntityIds(stack);

    // console.log('[fetchComponentAttributes]', eids );

    if (attr[0] === SType.Value) {
        attr = stringToComponentAttr(es, attr[1]);
    } else if (attr[0] !== SType.ComponentAttr) {
        throw new Error(`invalid component attr arg: ${attr[0]}`);
    }

    const [bf, ptr] = attr[1];

    const did = bfToValues(bf)[0];
    const def = es.getByDefId(did);
    const isJptr = ptr.startsWith('/');

    for (const eid of eids) {
        const cid = toComponentId(eid, did);
        const com = es.components.get(cid);

        if (com === undefined) {
            continue;
        }
        // console.log('[fetchComponentAttributes]', 'reading', cid, ptr );
        const val = isJptr ? Jsonpointer.get(com, ptr) : com[ptr];

        result.push([SType.Value, val]);
    }

    return [SType.List, result];
}

/**
 * Builds a ComponentAttr value - [Bitfield,string]
 *
 * @param es
 * @param stack
 */
export function onComponentAttr(stack: QueryStack): InstResult {
    const { es } = stack;

    const right: string = stack.popValue(0, false);

    const result = stringToComponentAttr(es, right);

    if (result === undefined) {
        throw new Error(`invalid component attr: ${right}`);
    }

    // console.log('[onComponentAttr]', result );

    return result;
}

export function stringToComponentAttr(es: EntitySet, val: string): StackValue {
    const parts: RegExpExecArray = /^(\/.*)#(.*)/.exec(val);

    if (parts === null) {
        return undefined;
    }

    const [, did, pointer] = parts;
    const bf = es.resolveComponentDefIds([did]);
    if (bfCount(bf) === 0) {
        throw new StackError(`def not found: ${did}`);
    }

    // console.log('[stringToComponentAttr]', bfToValues(bf) );

    return [SType.ComponentAttr, [bf, pointer]];
}

export function buildBitfield(stack: QueryStack): InstResult {
    const { es } = stack;
    const arg: StackValue = stack.pop();

    let dids = unpackStackValueR(arg, SType.Any);
    if (dids === 'all') {
        return [SType.BitField, createBitField('all')];
    }
    dids = isString(dids) ? [dids] : dids;
    const bf: BitField = es.resolveComponentDefIds(dids);

    // Log.debug('[buildBitfield]', arg, bfToValues(bf) );
    return [SType.BitField, bf];
}

/**
 * Fetches an entity instance
 * @e
 *
 * @param es
 * @param stack
 */
export async function fetchEntity(stack: ESMemQueryStack, [, op]: StackValue): AsyncInstResult {
    const { es } = stack;
    const debug = stack.scratch.debug ?? false;
    const returnEid = op === '@eid';

    let bf: BitField;
    let eids: EntityId[];
    let returnList = true;

    const isCount = stack.scratch.isCount ?? false;
    let [orderDir, orderDid, orderAttr, orderType] = stack.scratch.orderBy ?? ['desc'];
    const [offset, limit] = stack.scratch.limit ?? [0, Number.MAX_SAFE_INTEGER];
    if (orderType === undefined) {
        orderType = 'integer';
    }
    const isPtr = false;
    let orderDef: ComponentDef;

    if (orderDid !== undefined) {
        orderDef = es.getByDefId(orderDid);
        orderAttr = orderAttr.startsWith('/') ? orderAttr.substring(1) : orderAttr;
        const prop = getProperty(orderDef, orderAttr);
        if (prop === undefined) {
            console.log('[fetchEntity][orderBy]', 'could not find prop', orderAttr);
            orderDef = undefined;
        } else {
            orderType = prop.type;
        }
    }

    const matchOptions = { offset, limit, orderDef, orderAttr, orderDir, isCount };

    // !bf || 'all
    bf = stack.popBitFieldOpt();

    const arg = stack.peek();

    if (arg !== undefined) {
        const [type, val] = arg;
        if (type === SType.Value) {
            if (isInteger(val)) {
                stack.pop();
                eids = [val];
                returnList = false;
            }
        } else if (type === SType.List) {
            // console.log('[fetchEntity]', val);
            const arr = unpackStackValue(arg, SType.List, false);
            eids = arr.map((row) => entityIdFromValue(row)).filter(Boolean);
            stack.pop();
        }
    }

    const matches = matchEntities(es, eids, bf, matchOptions);
    if (isCount) {
        return [SType.Value, matches];
    }

    eids = matches as EntityId[];

    let result: any;

    if (returnEid) {
        result = returnList ? eids.map((eid) => [SType.Entity, eid]) : [SType.Entity, eids[0]];
    } else {
        const ents = es.getEntitiesByIdMem(eids, { populate: true });
        result = returnList ? ents.filter(Boolean).map((e) => [SType.Entity, e]) : [SType.Entity, ents[0]];
    }

    return returnList ? [SType.List, result] : result;
}

export interface MatchOptions {
    offset?: number;
    limit?: number;
    type?: number;
    orderDir?: 'asc' | 'desc';
    orderAttr?: string;
    orderDef?: ComponentDef;
    isCount?: boolean;
}

/**
 *
 * @param es
 * @param eids
 * @param mbf
 */
export function matchEntities(
    es: EntitySetMem,
    eids: EntityId[],
    dids: BitField | 'all',
    options: MatchOptions = { offset: 0, limit: Number.MAX_SAFE_INTEGER, orderDir: 'desc' },
): EntityId[] | number {
    let matches = [];
    const { offset, limit, orderDef, orderDir, orderAttr, isCount } = options;
    const isAll = dids === 'all' || dids === undefined || dids.isAllSet;
    const mbf = isBitField(dids) ? (dids as BitField) : undefined;
    const type = isAll ? TYPE_AND : mbf.type;
    let cmpFn = bfTypeFn(type); // bfAnd;
    if (type === TYPE_NOT) {
        cmpFn = bfNot;
    }

    let isPtr = false;
    let orderDid = undefined;
    let orderType = 'integer';

    if (orderDef !== undefined) {
        isPtr = orderAttr.startsWith('/');
        const prop = getProperty(orderDef, isPtr ? orderAttr.substring(1) : orderAttr);
        if (prop === undefined) {
            console.log('[fetchComponent][orderBy]', 'could not find prop', orderAttr);
            // orderDid = undefined;
        } else {
            orderType = prop.type;
            orderDid = getDefId(orderDef);
        }
    }

    // console.log('[matchEntities]', {isAll, orderDid, orderType, mbf});

    if (mbf && bfCount(mbf as BitField) === 0) {
        return isCount ? 0 : [];
    }

    let coll;

    if (eids !== undefined) {
        coll = [];
        for (let ii = 0; ii < eids.length; ii++) {
            const eid = eids[ii];
            const ebf = es.entities.get(eid);
            // console.log('[matchEntities]', eid, ebf);
            if (ebf !== undefined) {
                coll.push([eid, ebf]);
            }
        }
    } else {
        coll = es.entities;
    }

    // console.log('[matchEntities]', coll);

    for (const [eid, ebf] of coll) {
        if (mbf && cmpFn(mbf as BitField, ebf) === false) {
            continue;
        }
        // console.log('[matchEntities]', bfToValues(mbf), bfToValues(ebf) );

        if (orderDid !== undefined) {
            const orderCom = es.components.get(toComponentId(eid, orderDid));
            if (orderCom !== undefined) {
                let val = isPtr ? Jsonpointer.get(orderCom, orderAttr) : orderCom[orderAttr];
                if (val !== undefined) {
                    val = isString(val) ? val.toLowerCase() : val;
                    if (orderType === 'datetime') {
                        val = new Date(val).getTime();
                    }
                    matches.push([eid, val, orderType]);

                    continue;
                }
            }
        }

        // matches.push(eid);
        matches.push([eid, eid, orderType]);
    }

    if (isCount) {
        return matches.length;
    }

    // sort ascending
    matches.sort(([a, ac, at], [b, bc, bt]) => attrCompare(ac, bc, at, bt, orderDir));

    matches = matches.map(([e]) => e);
    // matches.sort(attrCompare);
    matches = matches.slice(offset, offset + limit);

    return matches;
}
