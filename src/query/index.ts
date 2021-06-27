import { SType, StackValue } from './types';

import {
    onAddComponentToEntity,
    onAddToEntitySet,
    onAdd,
    onPrint,
    onUnexpectedError,
    onBuildMap,
    onDrop,
    onSwap,
    onPush,
    onPop,
    onClear,
    onDup,
    onSelect,
    onComponentDef,
    fetchComponentDef,
    onComponent,
    onEntity,
    onAssertType,
    onPrintStack,
    onToString,
    onRegex,
    onDateTime,
    onRot,
    onSize,
    onRemoveFromEntitySet,
    onJoin,
    onUndefined,
    onRegexBuild,
    onCompare,
    onThrow,
} from './words';
import { onPluck } from './words/pluck';
import { onDefine, onFetchWord } from './words/define';
import { onDo, onLoop } from './words/loop';
import { QueryStack } from './stack';
import { tokenizeString } from './tokenizer';
import { onCondition, onLogicalOp } from './words/cond';
import { Entity, EntityId } from '../entity';
import { getComponentDefId, getComponentEntityId } from '../component';
import {
    onAddList,
    onListFetch,
    onConcat,
    onDiff,
    onFilter,
    onGather,
    onListEval,
    onListOpen,
    onListSpread,
    onMap,
    onReduce,
    onUnique,
    onListIndexOf,
} from './words/list';
import { onMapOpen } from './words/map';
export { QueryStack };
export const parse = (q: string) => tokenizeString(q, { returnValues: true });

export interface QueryOptions {
    stack?: QueryStack;
    values?: StackValue[];
    reset?: boolean;
    insts?: StackValue[];
}

export interface StatementArgs {
    [key: string]: any;
}
/**
 *
 */
export class Statement {
    q: string;
    insts: any[];
    stack: QueryStack;
    values: StackValue[];

    constructor(q: string, options: QueryOptions = {}) {
        this.q = q;
        this.stack = options.stack ?? createStdLibStack();
        this.insts = options.insts ?? tokenizeString(q, { returnValues: true });
        this.values = options.values;
    }

    async clear() {
        await this.stack.clear();
        if (this.values) {
            await this.stack.pushValues(this.values);
        }
    }

    async run(args?: StatementArgs, debug = false) {
        await this.clear();
        // if( debug ) console.log('[run]', this );
        // console.log('[run]', this.stack._idx, this.stack._stacks.map(s => s.id) );

        if (args !== undefined) {
            // if( debug ) console.log('[run]', 'args', Object.keys(args) );
            const defines = Object.keys(args).reduce((out, key) => {
                let val = args[key];
                val = Array.isArray(val) ? [SType.List, val.map((v) => [SType.Value, v])] : [SType.Value, val];
                return [...out, val, [SType.Value, key], [SType.Value, 'let']];
            }, []);
            // if( debug ) console.log('[run]', 'defines', defines );
            await this.stack.pushValues(defines);
        }

        try {
            // if( debug ) console.log('[run]', this.insts );
            await this.stack.pushValues(this.insts, { debug });
        } catch (err) {
            console.error('[run]', this.q.substring(0, Math.min(256, this.q.length)));

            throw err;
        }

        return this;
    }

    /**
     * Runs the statement and returns the top item
     * on the result stack
     *
     * @param args
     */
    async pop(args?: StatementArgs) {
        await this.run(args);
        return this.stack.popValue();
    }

    /**
     * Runs the values on the stack and returns
     * the top value
     *
     * @param args
     */
    async getResult(args?: StatementArgs, debug = false) {
        await this.run(args, debug);
        // if( debug ) console.log('[getResult]', this.stack.toString() );
        // if( debug )console.log('[getResult]', this.stack );
        const result = this.stack.popValue();
        // if( debug ) console.log('[getResult]', 'result', result );
        return result;
    }

    /**
     * Returns the user defined word defined on the stack
     *
     * @param word
     */
    getValue(word: string) {
        return this.stack.getUDValue(word);
    }

    /**
     * Runs the query and returns the result as an array of
     * entities if appropriate
     *
     * @param args
     */
    async getEntities(args?: StatementArgs): Promise<Entity[]> {
        await this.run(args);

        const value = this.stack.pop();
        let result: Entity[] = [];
        if (value === undefined) {
            return result;
        }

        const es = this.stack.es;
        const [type, val] = value;

        if (type === SType.List) {
            let e: Entity;
            let em: Map<EntityId, Entity>;
            for (const [lt, lv] of val) {
                if (lt === SType.Entity) {
                    result.push(lv);
                } else if (lt === SType.Component) {
                    const eid = getComponentEntityId(lv);

                    if (em === undefined) {
                        em = new Map<EntityId, Entity>();
                    }

                    e = em.get(eid) ?? es.createEntity(eid);
                    e.addComponentUnsafe(lv);
                    em.set(eid, e);
                }
            }
            if (em !== undefined) {
                result = Array.from(em.values());
            }
        } else if (type === SType.Component) {
            const eid = getComponentEntityId(val);
            const e = es.createEntity(eid);
            e.addComponentUnsafe(val);
            result.push(e);
        } else if (type == SType.Entity) {
            result.push(val);
        } else if (type === SType.Value) {
            result.push(await es.getEntity(val, true));
        }

        return result;
    }

    async getEntity(args?: StatementArgs): Promise<Entity> {
        const res = await this.getEntities(args);
        return res.length > 0 ? res[0] : undefined;
    }
}

/**
 *
 * @param q
 * @param options
 */
export async function query(q: string, options: QueryOptions = {}): Promise<QueryStack> {
    const stack = options.stack ?? createStdLibStack();
    const values = options.values;

    if (values) {
        await stack.pushValues(values);
    }

    if (q) {
        const insts = tokenizeString(q, { returnValues: true });
        await stack.pushValues(insts);
    }

    return stack;
}

/**
 *
 * @param stack
 */
export function createStdLibStack(stack?: QueryStack) {
    stack = stack ?? new QueryStack();

    stack = stack.addWords([
        ['+', onAddComponentToEntity, SType.Entity, SType.Component],
        ['+', onAddComponentToEntity, SType.Entity, SType.List],
        ['+', onAddToEntitySet, SType.EntitySet, SType.Any],
        ['-', onRemoveFromEntitySet, SType.EntitySet, SType.Any],
        // pattern match stack args
        ['+', onAddList, SType.List, SType.Any],
        ['+', onAddList, SType.Any, SType.List],

        ['eval', onRegex, SType.Any, SType.Regex],
        ['split', onRegex, SType.Value, SType.Regex],
        ['replace', onRegex, SType.Value, SType.Value, SType.Regex],
        ['==', onRegex, SType.Value, SType.Regex],
        ['!=', onRegex, SType.Value, SType.Regex],
        ['!r', onRegexBuild, SType.Value],

        ['==', onDateTime, SType.DateTime, SType.DateTime],
        ['!=', onDateTime, SType.DateTime, SType.DateTime],
        ['>', onDateTime, SType.DateTime, SType.DateTime],
        ['>=', onDateTime, SType.DateTime, SType.DateTime],
        ['<', onDateTime, SType.DateTime, SType.DateTime],
        ['<=', onDateTime, SType.DateTime, SType.DateTime],

        // important that this is after more specific case
        ['+', onAdd, SType.Value, SType.Value],
        ['-', onAdd, SType.Value, SType.Value],
        ['*', onAdd, SType.Value, SType.Value],
        ['%', onAdd, SType.Value, SType.Value],
        ['==', onAdd, SType.Value, SType.Value],
        ['!=', onAdd, SType.Value, SType.Value],
        ['>', onAdd, SType.Value, SType.Value],
        ['>=', onAdd, SType.Value, SType.Value],
        ['<', onAdd, SType.Value, SType.Value],
        ['<=', onAdd, SType.Value, SType.Value],
        ['.', onPrint, SType.Any],
        ['..', onPrint],

        ['==', onCompare, SType.Any, SType.Any],
        ['!=', onCompare, SType.Any, SType.Any],

        ['@', onListFetch, SType.List, SType.Value],
        ['@', onFetchWord, SType.Value],

        // a defined value is evaled when pushed onto the stack
        ['define', onDefine, SType.Any, SType.Value],
        // a let or ! value is just pushed onto the stack
        ['let', onDefine, SType.Any, SType.Value],
        ['!', onDefine, SType.Any, SType.Value],

        ['[', onListOpen],
        ['{', onMapOpen],
        ['}', onUnexpectedError],
        [']', onUnexpectedError],
        ['to_map', onBuildMap],
        ['to_str!', onToString],
        ['to_str', onToString],
        ['join', onJoin],
        // ['join', onJoin, SType.Value, SType.Value],
        // ['join', onJoin, SType.List, SType.Value],
        ['drop', onDrop, SType.Any],
        ['swap', onSwap, SType.Any, SType.Any],
        ['push', onPush, SType.List, SType.Any],
        ['pop?', onPop, SType.List],
        ['pop!', onPop, SType.List],
        ['pop', onPop, SType.List],
        ['map', onMap, SType.List, SType.Value],
        ['map', onMap, SType.List, SType.List],
        ['pluck', onPluck, SType.Map, SType.Value],
        ['pluck', onPluck, SType.Component, SType.Value],
        ['pluck', onPluck, SType.List, SType.Value],
        ['pluck', onPluck, SType.List, SType.List],
        ['pluck', onPluck, SType.Any, SType.Any],
        ['pluck!', onPluck, SType.Any, SType.Any],
        ['diff', onDiff, SType.Any, SType.Any],
        ['diff!', onDiff, SType.Any, SType.Any],
        ['intersect', onDiff, SType.Any, SType.Any],
        ['intersect!', onDiff, SType.Any, SType.Any],
        ['union', onDiff, SType.Any, SType.Any],
        ['union!', onDiff, SType.Any, SType.Any],

        ['unique', onUnique, SType.List],
        ['filter', onFilter, SType.List, SType.Value],
        ['filter', onFilter, SType.List, SType.List],
        ['reduce', onReduce, SType.List, SType.Any, SType.Any],
        ['index_of', onListIndexOf, SType.List, SType.Value],
        ['index_of!', onListIndexOf, SType.List, SType.Value],

        ['gather', onGather],
        // ['concat', onConcat],
        ['concat', onConcat, SType.Any, SType.List],
        ['cls', onClear],
        ['dup', onDup, SType.Any],
        ['over', onDup, SType.Any],
        ['rot', onRot, SType.Any, SType.Any, SType.Any],
        ['select', onSelect, SType.Any, SType.List],
        ['select_count', onSelect, SType.Any, SType.List],
        ['spread', onListSpread, SType.List],

        ['eval', onListEval, SType.List],
        // ['cond', onCondition, SType.Any, SType.Any, SType.Any], // cond, if, else
        ['iif', onCondition, SType.Any, SType.Any, SType.Any], // cond, if, else
        ['if', onCondition, SType.Any, SType.Any],

        ['and', onLogicalOp, SType.Any, SType.Any],
        ['or', onLogicalOp, SType.Any, SType.Any],
        ['??', onLogicalOp, SType.Any, SType.Any],

        ['size!', onSize, SType.Any], // destructive (any -- int)
        ['size', onSize, SType.Any], // non destructive (any -- any int)
        ['loop', onLoop, SType.List],
        ['do', onDo, SType.List, SType.Value, SType.Value],
        ['?do', onDo, SType.List, SType.Value, SType.Value],

        ['undefined', onUndefined],
        ['!d', onComponentDef, SType.Map],
        ['!d', onComponentDef, SType.List],
        ['!d', onComponentDef, SType.Value],
        ['@d', fetchComponentDef, SType.EntitySet],
        ['@d', fetchComponentDef, SType.EntitySet, SType.Value],

        ['!c', onComponent, SType.List],
        ['!e', onEntity, SType.List],
        ['!e', onEntity, SType.Value],
        ['assert_type', onAssertType],
        ['prints', onPrintStack],
        ['throw', onThrow, SType.Value],
        [
            'debug',
            () => {
                stack.scratch.debug = !!!stack.scratch.debug;
                return undefined;
            },
        ],
    ]);

    return stack;
}
