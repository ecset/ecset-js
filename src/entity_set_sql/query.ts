import Jsonpointer from 'jsonpointer';
import { EntityId, Entity, getEntityId, isEntity } from '../entity';
import { BitField, toValues as bfToValues, isBitField, TYPE_OR } from '@odgn/utils/bitfield';
import { EntitySetSQL, ComponentDefSQL } from '.';
import { createLog } from '../util/log';
import { isInteger, isString, isBoolean } from '@odgn/utils';

import { isStackValue, entityIdFromValue, QueryStack } from '../query/stack';
import { SType, StackValue, InstResult, AsyncInstResult, StackError } from '../query/types';
import { getComponentDefsFromBitField, stackToString, unpackStackValue, unpackStackValueR } from '../query/util';
import {
    sqlRetrieveEntitiesByDefId,
    sqlRetrieveByFilterQuery,
    sqlRetrieveEntityComponents,
    sqlRetrieveComponents,
    sqlRetrieveEntities,
    sqlRetrieveComponent,
    RetrieveOptions,
} from './sqlite';
import { onLogicalFilter, parseFilterQuery } from '../entity_set_mem/query/filter';
import { onComponentAttr, buildBitfield, stringToComponentAttr, onOrder, applyLimit } from '../entity_set_mem/query';
import { onDefine } from '../query/words/define';
import { onPluck } from '../query/words/pluck';
import { onBitFieldNot, onBitFieldOr, onPrintStack } from '../query/words';
import { onDiff } from '../query/words/list';
import { getProperty } from '../component_def';
import { SelectOptions } from '../entity_set/queryable';

const Log = createLog('SQLQuery');

class SQLQueryStack extends QueryStack {
    es: EntitySetSQL;
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

    // if (stack.scratch.debug) console.log('[select] 1', { _idx: stack._idx, _stacks: stack._stacks });

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

        // ['debug', () => { stack.scratch.debug = true; return undefined }],
        [
            'debug',
            () => {
                stack.scratch.debug = !!!stack.scratch.debug;
                return undefined;
            },
        ],

        // ['test', () => { console.log('TEST called'); return undefined }],
    ]);

    // reset ordering and limits
    stack.scratch.orderBy = undefined;
    stack.scratch.limit = [0, Number.MAX_SAFE_INTEGER];
    stack.scratch.isCount = options.isCount ?? false;

    // Log.debug('[select] query', query);
    await stack.pushValues(query);

    // reset stack items and words
    let items = stack.items;
    stack.clear(true, false, false);

    // Log.debug('[select] post');
    // ilog(items);

    // add 2nd pass words
    stack.addWords([
        ['@e', fetchEntity],
        ['@eid', fetchEntity],
        ['@c', fetchComponents],
        ['@cid', fetchComponents],
        ['@ca', fetchComponentAttributes],

        ['@v', fetchValue],
        ['!fil', applyFilter, SType.Filter],

        ['pluck', onPluck],
        ['pluck!', onPluck],
        ['diff', onDiff],
        ['diff!', onDiff],
        ['intersect', onDiff],
        ['intersect!', onDiff],
        ['union', onDiff],
        ['union!', onDiff],
        ['prints', onPrintStack],
        [
            'debug',
            () => {
                stack.scratch.debug = !!!stack.scratch.debug;
                return undefined;
            },
        ],
    ]);

    // make sure any filter values have a following cmd
    items = items.reduce((result, value, ii, items) => {
        if (value[0] === SType.Filter) {
            return [...result, value, '!fil'];
        }
        return [...result, value];
    }, []);

    // Log.debug('pushing ', items);
    await stack.pushValues(items);

    const result = stack.items;

    // if (stack.scratch.debug) console.log('[select] 2', { _idx: stack._idx, _stacks: stack._stacks });

    stack.restoreParent();

    // if (stack.scratch.debug) console.log('[select] 3', stack.items );

    return result;
}
/*
    and 
        (%bf, [8]) // this creates an eid list
        and // these 2 conditions need to be compressed into a single, because they both ref the same com
            == // FROM tbl_pos WHERE rank = 2
                2 
                (%ca, [[1],"rank"]) 
            == // FROM tbl_pos WHERE file = z
                "z" 
                (%ca, [[1],"file"])
*/

/*
[
  'and',
  { dids: [ 8 ] },
  [
    'and',
    [ '==', [ 'colour', 'black' ], { def: '/component/colour' } ],
    [ '==', [ 'file', 'z' ], { def: '/component/position' } ]
  ]
]

*/

function readEntityIds(stack: SQLQueryStack, options = {}): EntityId[] {
    const { es } = stack;

    let eids: EntityId[];

    const bf = stack.popBitFieldOpt();

    if (bf === undefined) {
        // Log.debug('[readEntityIds]', stack.peek() );
        if (stack.peek() !== undefined) {
            const [type, val] = stack.pop();
            if (type === SType.Entity) {
                return [unpackStackValueR([type, val])];
            } else if (type === SType.List) {
                return val
                    .map((it) => {
                        return isStackValue(it) ? getEntityId(it[1]) : isEntity(it) ? getEntityId(it) : undefined;
                    })
                    .filter(Boolean);
            } else if (type === SType.Value && val === false) {
                return [];
            }
            // Log.debug('[readEntityIds]', from);
        }
    }

    const [orderDir, orderDid, orderAttr, orderType] = stack.scratch.orderBy ?? ['asc'];
    const [offset, limit] = stack.scratch.limit ?? [0, Number.MAX_SAFE_INTEGER];
    const pageOptions = { offset, limit, orderDir };

    eids = matchEntities(es, bf, undefined, { ...pageOptions, ...options, returnEid: true }) as EntityId[];
    // Log.debug('[readEntityIds]', ents);
    // eids = ents.map(e => e.id);

    // default to all of the entity ids
    return eids;
}

function buildEntitySelect(stack: SQLQueryStack): string {
    const { es } = stack;

    let eids: EntityId[];

    const bf = stack.popBitFieldOpt();

    if (bf === undefined) {
        const from = stack.peek();

        if (from !== undefined) {
            stack.pop();
            if (from[0] === SType.Entity) {
                // throw new StackError('not implemented bES1');
                eids = [unpackStackValueR(from)];
                // Log.debug('[fetchComponent]', 'fetching from entity', eids);
            } else if (from[0] === SType.List) {
                // throw new StackError('not implemented bES2');
                eids = from[1]
                    .map((it) => {
                        return isStackValue(it) ? getEntityId(it[1]) : isEntity(it) ? getEntityId(it) : undefined;
                    })
                    .filter(Boolean);
            } else if (from[0] === SType.Value && from[1] === false) {
                // return [];
                // throw new StackError('not implemented bES3');
            }
            // Log.debug('[readEntityIds]', from);
        }
    }

    const [orderDir, orderDid, orderAttr, orderType] = stack.scratch.orderBy ?? ['desc'];
    const [offset, limit] = stack.scratch.limit ?? [0, Number.MAX_SAFE_INTEGER];
    const options = { offset, limit, orderDir, returnSQL: true };

    return matchEntities(es, bf, eids, options) as string;
}

export function applyFilter(stack: SQLQueryStack): InstResult {
    let filter;
    const { es } = stack;
    const debug = stack.scratch.debug ?? false;
    [, filter] = stack.pop();

    // if( debug ) Log.debug('[applyFilter]', filter );
    // determine whether the previous stack argument can give us
    // a set of eids. if not, then the filter is applied to all the entities
    // in the es
    // let eids = readEntityIds(stack);
    const eidSql = buildEntitySelect(stack);

    // Log.debug('[applyFilter]', 'eidSql', eidSql );

    let result = parseFilterQuery(es, filter[0], filter[1], filter[2]);

    // if( debug ) Log.debug('[applyFilter]', 'filter', filter );
    // if (debug) Log.debug('[applyFilter]', 'query', result);
    // Log.debug('[applyFilter]', 'query', result);

    result = sqlRetrieveByFilterQuery(es.db, undefined, result, { selectEidSql: eidSql, debug });

    // Log.debug('[applyFilter]', 'result', result );

    // ilog( result );

    return result;
}

export function fetchValue(stack: SQLQueryStack): InstResult {
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

export function fetchComponents(stack: SQLQueryStack, [, op]: StackValue): InstResult {
    const { es } = stack;
    let left, right: StackValue;
    let eids: EntityId[];
    const returnCid = op === '@cid';
    // let defs: ComponentDefSQL[];

    // get the bitfield
    // defs = stack.popBitField(true) as ComponentDefSQL[];
    const bf = stack.popBitFieldOpt();
    const defs = getComponentDefsFromBitField(es, bf) as ComponentDefSQL[];

    // Log.debug('[fetchComponent]', 'bf', defs );

    left = stack.peek();

    if (left !== undefined) {
        const from = stack.pop();
        // Log.debug('[fetchComponent]', 'arg', from);
        // Log.debug('[fetchComponents]', from );
        if (from[0] === SType.Entity) {
            eids = [unpackStackValueR(from)];
        } else if (from[0] === SType.List) {
            eids = from[1]
                .map((it) => {
                    return isStackValue(it) ? getEntityId(it[1]) : isEntity(it) ? getEntityId(it) : undefined;
                })
                .filter(Boolean);
        } else {
            return [SType.List, []];
        }
    }

    let coms = [];
    // Log.debug('[fetchComponent]', 'good', eids, defs );

    const isCount = stack.scratch.isCount ?? false;
    let [orderDir, orderDid, orderAttr, orderType] = stack.scratch.orderBy ?? ['desc'];
    const [offset, limit] = stack.scratch.limit ?? [0, Number.MAX_SAFE_INTEGER];
    if (orderType === undefined) {
        orderType = 'integer';
    }
    const isPtr = false;
    let orderDef: ComponentDefSQL;

    if (orderDid !== undefined) {
        orderDef = es.getByDefId(orderDid);
        orderAttr = orderAttr.startsWith('/') ? orderAttr.substring(1) : orderAttr;
        const prop = getProperty(orderDef, orderAttr);
        if (prop === undefined) {
            console.log('[fetchComponent][orderBy]', 'could not find prop', orderAttr);
            orderDef = undefined;
        } else {
            orderType = prop.type;
        }
        // Log.debug('[fetchComponent]', 'orderBy', orderDid, orderAttr);
    }

    const allDefs = bf === undefined || (isBitField(bf) && bf.isAllSet) || defs === undefined;
    const optDefs = bf !== undefined && bf.type === TYPE_OR;
    // Log.debug('[fetchComponent]', {allDefs, isAllSet:(isBitField(bf) && bf.isAllSet), undefined:(defs===undefined)}, bf);
    const options = { allDefs, optDefs, offset, limit, isCount, orderDef, orderDir, orderAttr, returnCid };

    // if (returnCid) {
    // coms = sqlRetrieveComponentIds(es.db, eids, defs || es.componentDefs, options);
    //     return [SType.List, coms.map(cid => [SType.Value, cid])];
    // }

    // Log.debug('[fetchComponent]', 'options', options);
    // Log.debug('[fetchComponent]', 'defs', es.componentDefs);
    coms = sqlRetrieveComponents(es.db, eids, defs || es.componentDefs, options);

    if (isCount) {
        return [SType.Value, coms];
    }

    return [SType.List, returnCid ? coms.map((cid) => [SType.Value, cid]) : coms.map((c) => [SType.Component, c])];
}

export function fetchComponentAttributes(stack: SQLQueryStack): InstResult {
    const { es } = stack;
    const result = [];

    // get the attribute
    let attr = stack.pop();

    // determine whether the previous stack argument can give us
    // a set of eids. if not, then the filter is applied to all the entities
    // in the es
    const eids = readEntityIds(stack);

    // console.log('[fetchComponentAttributes]', eids, attr );

    if (attr[0] === SType.Value) {
        attr = stringToComponentAttr(es, attr[1]);
    } else if (attr[0] !== SType.ComponentAttr) {
        throw new Error(`invalid component attr arg: ${attr[0]}`);
    }

    const [bf, ptr] = attr[1];

    const did = bfToValues(bf)[0];
    const def = es.getByDefId(did);
    const isJptr = ptr.startsWith('/');

    // Log.debug('[fetchComponentAttributes]', eids );

    for (const eid of eids) {
        const def = es.getByDefId(did);
        const com = sqlRetrieveComponent(es.db, eid, def);

        // Log.debug('[fetchComponentAttributes]', 'reading', eid, cid, com );
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
 * Fetches an entity instance
 *
 * @param es
 * @param stack
 */
export async function fetchEntity(stack: SQLQueryStack, [, op]: StackValue): AsyncInstResult {
    const { es } = stack;
    // const debug = stack.scratch.debug ?? false;
    // let data: StackValue = stack.pop();
    const returnEid = op === '@eid';

    // const type = data[0];
    // let eid = unpackStackValueR(data, SType.Any);
    let bf: BitField;
    let eids: EntityId[];
    let ents: Entity[];
    let returnList = true;

    // Log.debug('[fetchEntity]', data, eid);

    const isCount = stack.scratch.isCount ?? false;
    let [orderDir, orderDid, orderAttr, orderType] = stack.scratch.orderBy ?? ['asc'];
    const [offset, limit] = stack.scratch.limit ?? [0, Number.MAX_SAFE_INTEGER];
    if (orderType === undefined) {
        orderType = 'integer';
    }
    const isPtr = false;
    let orderDef: ComponentDefSQL;

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
        // Log.debug('[fetchComponent]', 'orderBy', orderDid, orderAttr);
    }

    const matchOptions = { isCount, offset, limit, orderDef, orderAttr, orderDir, returnEid };

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

    // console.log('[fetchComponent]', 'yo', {returnList, returnEid}, eids, bfToValues(bf));

    // todo - an optimisation here might be to return only eids rather than full entities
    ents = matchEntities(es, bf, eids, matchOptions) as Entity[];

    // console.log('[fetchComponent]', 'yo', {returnList, returnEid}, ents, bfToValues(bf));

    if (isCount) {
        return [SType.Value, ents];
    }

    let result: any;

    if (returnEid) {
        result = ents.map((e) => [SType.Entity, isEntity(e) ? e.id : e]);
        return returnList ? [SType.List, result] : [SType.Entity, ents.length > 0 ? ents[0] : 0];
    }

    result = ents.map((e) => {
        e = es.createEntity(e.id, e.bitField);
        e = es.retrieveEntityComponents(e);
        return [SType.Entity, e];
    });

    // result = ents.map(e => [SType.Entity, e]);

    // if (!returnList) {
    //     result = [SType.Entity, ents.length > 0 ? ents[0] : 0];
    // }

    // if (returnEid) {
    //     result = returnList ? ents.map(e => [SType.Entity, e.id]) : [SType.Entity, ents.length > 0 ? ents[0].id : 0];
    // } else {
    //     // let ents = es.getEntitiesByIdMem(eids, { populate: true });
    //     result = returnList ? ents.map(e => [SType.Entity, e]) : [SType.Entity, ents.length > 0 ? ents[0] : 0];
    // }

    // console.log('ok', returnList, result);

    return returnList ? [SType.List, result] : [SType.Entity, ents.length > 0 ? ents[0] : 0];
}

/**
 *
 * @param es
 * @param mbf
 * @param eids
 * @param options
 */
function matchEntities(
    es: EntitySetSQL,
    mbf?: BitField,
    eids?: EntityId[],
    options: RetrieveOptions = { offset: 0, limit: Number.MAX_SAFE_INTEGER, orderDir: 'desc' },
): Entity[] | EntityId[] | string {
    if (mbf === undefined || mbf.isAllSet) {
        return sqlRetrieveEntities(es.db, eids, options);
    }

    if (es.db === undefined) {
        console.log('UH OH', es);
    }

    return sqlRetrieveEntitiesByDefId(es.db, bfToValues(mbf), eids, { ...options, type: mbf.type });
}
