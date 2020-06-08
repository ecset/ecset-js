import {
    create as createQuery,

    addWords,
    pushValues,

    push, pop, peek, pushRaw,
    findV,
    clone as cloneStack,
    isStackValue,
    popOfType,
    isDLogEnabled
} from '../stack';
import {
    SType,
    QueryStack,
    StackValue,
    InstResult, AsyncInstResult,
    StackError,
} from '../types';
import {
    create as createComponentDef, isComponentDef, toShortObject as defToObject
} from '../../../src/component_def';
import {
    isBoolean, isObject, isInteger
} from '../../../src/util/is';
import {
    createComponent, getByDefId
} from '../../../src/entity_set/registry';
import {
    Entity, create as createEntityInstance, isEntity,
    addComponentUnsafe
} from '../../../src/entity';
import { isComponent, Component, isComponentList, getComponentDefId } from '../../../src/component';
import {
    create as createEntitySet,
} from '../../../src/entity_set';

import { EntitySet } from '../../../src/entity_set/types';

import { createLog } from "../../util/log";
import { stackToString, unpackStackValue, unpackStackValueR } from '../util';
import { addComponentToEntity } from '../../entity_set/util';

const Log = createLog('QueryWords');




/**
 * Duplicates the top stack value, or if the op is 'over', duplicates the previous
 * 
 * @param stack 
 * @param op 
 */
export async function onDup<QS extends QueryStack>(stack: QS, op): AsyncInstResult<QS> {
    let val = peek(stack);
    if (op === 'over') {
        val = peek(stack, 1);
    }

    let out;
    if (val[0] === SType.EntitySet) {
        let es: EntitySet = unpackStackValue(val, SType.EntitySet);
        let dup = await es.esClone(es);
        out = [SType.EntitySet, dup];
    } else {
        // let o = unpackStackValue(val);
        out = [...val];
    }

    return [stack, out];
}


export async function onSelect<QS extends QueryStack>(stack: QS): AsyncInstResult<QS> {
    let left, right;

    [stack, right] = pop(stack);
    [stack, left] = pop(stack);
    // left = peek(stack);

    let es: EntitySet = unpackStackValue(left, SType.EntitySet);
    let query = unpackStackValue(right, SType.List, false);
    // const {words} = stack;
    // Log.debug('[onSelect]', query );
    // Log.debug('[onSelect]', stack.words );

    // let words = Object.keys(stack.words).reduce( (out,word) => { 
    //     let spec = stack.words[word];
    //     for( let en of spec ){
    //         let [fn, clauses ] = en;
    //         out = [...out, [word, fn, ...clauses]];
    //     }
    //     return out;
    // },[]);

    let result = await es.esSelect(es, query, { stack });

    if (result) {
        // append output stack
        stack = { ...stack, items: [...stack.items, ...result] };
    }

    return [stack];
}

export function onArgError<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    Log.debug('[onArgError]', val);
    throw new StackError('invalid argument');
}


export function onEntity<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let data: StackValue;
    [stack, data] = pop(stack);
    let [type, val] = data;

    if (type === SType.List) {
        let e = val.reduce((acc, val) => {
            // Log.debug('[onEntity]', val);
            let type = val[0];
            if (type === SType.Component) {
                if (!acc) {
                    acc = createEntityInstance();
                }
                const did = getComponentDefId(val[1]);
                const def = getByDefId(stack.es, did);
                return addComponentUnsafe(acc, did, val[1], def.name);
            } else if (isInteger(val[1])) {
                return createEntityInstance(val[1]);
            }
        }, null);
        if (isEntity(e)) {
            return [stack, [SType.Entity, e]];
        }
    } else {
        let e = createEntityInstance(val);
        return [stack, [SType.Entity, e]];
    }

    // let eid = unpackStackValue(data, SType.Value);

    return [stack];
}


export function onComponent<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let data: StackValue;

    [stack, data] = pop(stack);
    let es = findV(stack, SType.EntitySet);

    if (es === undefined) {
        throw new Error('EntitySet not found on stack');
    }
    // cache a reference to the last entityset
    stack.es = es;

    let raw = unpackStackValue(data, SType.List, true);
    let [uri, attrs] = raw;

    // Log.debug('[onComponent]', uri, attrs);
    // Log.debug('[onComponent]', es );

    let com = createComponent(es, uri, attrs);
    // let def = createComponentDef( undefined, ...raw );

    return [stack, [SType.Component, com]];
}


export function onAddComponentToEntity<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let ev: StackValue, cv: StackValue;

    [stack, cv] = pop(stack);
    [stack, ev] = pop(stack);

    let e: Entity = unpackStackValue(ev, SType.Entity);
    let c: Component = unpackStackValueR(cv, SType.Any);
    const es = stack.es;

    if (Array.isArray(c)) {
        for (const com of c) {
            // const did = getComponentDefId(com);
            // const def = getByDefId(es,did);
            // e = addComponentUnsafe(e, did, com, def.name );
            e = addComponentToEntity(es, e, com);
        }
        // e = c.reduce((e, c) => addComponentToEntity(e, c), e);
    } else {
        e = addComponentToEntity(es, e, c);
    }
    // Log.debug('[onAddComponentToEntity]', c );

    return [stack, [SType.Entity, e]];
}



export async function onAddToEntitySet<QS extends QueryStack>(stack: QS): AsyncInstResult<QS> {
    let left, right;
    [stack, left] = pop(stack);
    [stack, right] = pop(stack);

    // DLog(stack, '[onAddToEntitySet]', left );
    let value = unpackStackValue(left);
    // DLog(stack, '[onAddToEntitySet]', isComponentDef(value), value );
    let es: EntitySet = unpackStackValueR(right, SType.EntitySet);

    // try {
    const { esAdd, esRegister, isAsync } = es;

    let values: StackValue[] = left[0] === SType.List ? left[1] : [left];

    // Log.debug('[onAddToEntitySet]', values );
    // sort into defs and e/com
    let defs = [];
    let coms = [];
    for (const value of values) {
        let [type, inner] = value;

        if (type === SType.ComponentDef) {
            if (!isComponentDef(inner)) {
                inner = parseComponentDef(inner);
            }
            defs.push(inner);
        } else if (isEntity(inner) || isComponent(inner)) {
            // Log.debug('[onAddToEntitySet]', inner);
            coms.push(inner);
        }
    }

    for (const def of defs) {
        [es] = isAsync ? await esRegister(es, def) : esRegister(es, def);
    }

    if (coms.length > 0) {
        const debug = isDLogEnabled(stack);
        // DLog(stack, '[onAddToEntitySet]', coms.length, 'coms', isDLogEnabled(stack) );
        es = isAsync ? await esAdd(es, coms, { debug }) : esAdd(es, coms, { debug });
    }

    // } 
    // catch (err) {
    //     Log.warn('[onAddToEntitySet]', 'error', value, err.stack);
    // }
    return [stack, [SType.EntitySet, es]];
}


export async function fetchComponentDef<QS extends QueryStack>(stack: QS): AsyncInstResult<QS> {
    let val = peek(stack);
    let es = stack.es;

    if (val[0] === SType.EntitySet) {
        es = unpackStackValue(val, SType.EntitySet);
    }

    return [stack, [SType.List, es.componentDefs.map(def => [SType.ComponentDef, defToObject(def)])]];
}


// export function onAddDefToES( stack:QueryStack, val:StackValue ):InstResult {
//     let def, es;
//     [stack,[,def]] = pop(stack);
//     [stack,[,es]] = pop(stack);

//     [es, def] = register( es, def )

//     return [stack, [SType.EntitySet, es] ];
// }

export function onEntitySet<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let data: StackValue;

    [stack, data] = pop(stack);

    let options = unpackStackValueR(data, SType.Map);
    let es = createEntitySet(options);

    return [stack, [SType.EntitySet, es]];
}

export function onComponentDef<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let data: StackValue;
    // try {

    [stack, data] = pop(stack);

    let raw;// = unpackStackValue(data);
    const [type] = data;
    if (type === SType.List) {
        raw = unpackStackValueR(data, SType.List);
    } else if (type === SType.Map) {
        raw = [unpackStackValueR(data, SType.Map)];
    } else if (type === SType.Value) {
        raw = unpackStackValueR(data, SType.Any);
        raw = [raw];
    }

    return [stack, [SType.ComponentDef, parseComponentDef(raw)]];
    // } catch (err) {
    //     Log.debug('[onComponentDef]', err.message);
    //     return [stack];
    // }
}

function parseComponentDef(data: any[]) {
    // ensure props are wrapped in an array
    let [uri, props] = data;
    if (props !== undefined && !Array.isArray(props)) {
        Log.debug('[onComponentDef]', data);
        throw new StackError(`onComponentDef : properties should be wrapped in array: ${uri}`);
    }

    return createComponentDef(undefined, ...data);
}




export function onPrint<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let msg;
    const [, op] = val;
    if (op === '..') {
        console.info('[onPrint][stack]', '(', stackToString(stack), ')');
    } else {
        [stack, msg] = pop(stack);
        console.info('[onPrint]', unpackStackValueR(msg));
    }
    return [stack];
}

export function onAddArray<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let left, right;
    [stack, left] = pop(stack);
    [stack, right] = pop(stack);
    let [type, arr] = right;
    arr = [...arr, left];
    return [stack, [type, arr]];
}

export function onFetchArray<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let left, right;
    [stack, left] = pop(stack);
    [stack, right] = pop(stack);
    let arr = unpackStackValue(right, SType.List);
    let idx = unpackStackValue(left, SType.Value);
    return [stack, arr[idx]];
}




export function onAdd<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let lv, rv;
    let op = val[1];

    [stack, lv] = pop(stack);
    [stack, rv] = pop(stack);

    let left = unpackStackValue(lv, SType.Value);
    let right = unpackStackValue(rv, SType.Value);

    let value = left;
    switch (op) {
        case '+': value = left + right; break;
        case '*': value = left * right; break;
        case '-': value = left - right; break;
        case '%': value = left % right; break;
        case '==': value = left === right; break;
        case '!=': value = left !== right; break;
    }

    // Log.debug('[onAdd]', op, left, right, value);

    return [stack, [SType.Value, value]];
}

export function onMapOpen<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let sub = createQuery<QS>();
    // Log.debug('[onMapOpen]', stack.items);//Object.keys(stack.words));
    // DLog(stack, '[onMapOpen]', stack.items );

    sub._parent = stack;
    sub._root = stack._root ? stack._root : stack;
    // Log.debug('[onMapOpen]', {id:sub.id, parent:sub._parent?.id,root:sub._root?.id}, stackToString(stack) );

    // add something which will interpret each push
    sub = addWords<QS>(sub, [
        ['{', onMapOpen],
        ['[', onListOpen],
        ['}', onMapClose],
        [']', onUnexpectedError],
    ], true);
    // throw 'stop';
    // (sub as any)._stack = stack;
    return [sub];
}

export function onUnexpectedError<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    throw new StackError(`unexpected word '${val}'`);
}

export function onMapClose<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    // if( stack.id === 158 ){
    //     Log.debug('[onMapClose]', {id:stack.id, parent:stack._parent?.id}, stackToString(stack) );
    //     Log.debug('[onMapClose]', stack);
    // }
    let map = stack.items.reduce((result, val, idx, array) => {
        if (idx % 2 === 0) {
            let key = unpackStackValue(val);
            let mval = array[idx + 1];
            // console.log('key!', key, array);
            result[key] = mval === undefined ? [SType.Value, undefined] : mval;
        }
        return result;
    }, {});
    val = [SType.Map, map];
    stack = stack._parent;
    return [stack, val];
}

export function onListOpen<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let sub = createQuery<QS>();
    sub._parent = stack;
    sub._root = stack._root ? stack._root : stack;
    // Log.debug('[onListOpen]', {id:sub.id, parent:sub._parent?.id,root:sub._root?.id}, stackToString(stack) );
    // sub.words = {...stack.words};
    sub = addWords<QS>(sub, [
        ['{', onMapOpen],
        ['[', onListOpen],
        [']', onListClose],
        ['}', onUnexpectedError],
        // ['arse', onUnexpectedError],
    ], true);
    return [sub];
}

export function onListClose<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    // Log.debug('[onListClose]', {id:stack.id, parent:stack._parent?.id}, stackToString(stack) );
    val = [SType.List, stack.items];
    stack = stack._parent;
    return [stack, val];
}

export async function onArraySpread<QS extends QueryStack>(stack: QS, val: StackValue): AsyncInstResult<QS> {
    [stack, val] = pop(stack);
    let value = unpackStackValueR(val, SType.List).map(v => [SType.Value, v]);

    // if( val[0] === SType.List ){
    //     value = value.map( v => [Array.isArray(v) ? SType.List : SType.Value, v] );
    // stack = { ...stack, items: [...stack.items, ...value] };
    // Log.debug('[onArraySpread]', value);
    [stack,] = await pushValues(stack, value);
    // }
    return [stack];
}

export function onValue<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    [stack, val] = pop(stack);
    let value = unpackStackValueR(val);
    if (val[0] === SType.List) {
        value = value.map(v => [Array.isArray(v) ? SType.List : SType.Value, v]);
        stack = { ...stack, items: [...stack.items, ...value] };
    }
    return [stack];
}


/**
 * Creates an array from the values on the stack, providing they are of the 
 * same type
 * 
 * @param stack 
 * @param val 
 */
export function onConcat<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let first;
    let values: StackValue[];
    [stack, first] = pop(stack);
    let type: SType = first[0]; //unpackStackValue(first, SType.Value);

    [stack, values] = popOfType(stack, type);

    values = [first, ...values];

    return [stack, [SType.List, values]];
}

export function onBuildMap<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let left, right;
    let values: StackValue[];
    [stack, left] = pop(stack);
    let array = unpackStackValue(left, SType.List, false);



    let map = array.reduce((result, val, idx, array) => {
        if (idx % 2 === 0) {
            let key = unpackStackValue(val, SType.Value);
            let mval = array[idx + 1];
            // Log.debug('[onBuildMap]', key, mval );
            result[key] = mval === undefined ? [SType.Value, undefined] : mval;
        }
        return result;
    }, {});

    // Log.debug('[onBuildMap]', map );

    return [stack, [SType.Map, map]];
}

export async function onFilter<QS extends QueryStack>(stack: QS): AsyncInstResult<QS> {
    let array, fn;
    [stack, fn] = pop(stack);
    [stack, array] = pop(stack);

    array = unpackStackValue(array, SType.List);
    fn = unpackStackValue(fn, SType.List);

    let mapStack = cloneStack(stack, { words: true, items: false });
    let accum = [];

    [mapStack, accum] = await array.reduce(async (result, val) => {
        [mapStack, accum] = await result;
        [mapStack] = await push(mapStack, val);
        [mapStack] = await pushValues(mapStack, fn);
        let out;
        // Log.debug('[onFilter]', 'end', mapStack.items );
        [mapStack, out] = pop(mapStack);
        if (isTruthy(out)) {
            accum = [...accum, val];
        }

        return [mapStack, accum];
    }, Promise.resolve([mapStack, accum]));

    return [stack, [SType.List, accum]];
}

export async function onMap<QS extends QueryStack>(stack: QS): AsyncInstResult<QS> {
    let left, right;
    [stack, right] = pop(stack);
    [stack, left] = pop(stack);

    let array = unpackStackValue(left, SType.List);
    let fn = unpackStackValue(right, SType.List);

    let mapStack = cloneStack(stack, { words: true, items: false });

    mapStack = await array.reduce(async (mapStack, val) => {
        mapStack = await mapStack;
        // Log.debug('[onMap]','ok', val);
        [mapStack] = await push(mapStack, val);
        [mapStack] = await pushValues(mapStack, fn);

        return mapStack;
    }, Promise.resolve(mapStack));

    // Log.debug('[onMap]', 'end', mapStack.items );

    return [stack, [SType.List, mapStack.items]];
}

export async function onReduce<QS extends QueryStack>(stack: QS): AsyncInstResult<QS> {
    let left, right, accum;
    [stack, right] = pop(stack);
    [stack, accum] = pop(stack);
    [stack, left] = pop(stack);

    let array = unpackStackValue(left, SType.List);
    accum = unpackStackValue(accum, SType.Any);
    let fn = unpackStackValue(right, SType.List);

    let mapStack = cloneStack(stack, { words: true, items: false });

    [mapStack, accum] = await array.reduce(async (result, val) => {
        [mapStack, accum] = await result;
        // Log.debug('[onMap]','ok', val);
        [mapStack] = await push(mapStack, val);
        [mapStack] = await push(mapStack, accum);
        [mapStack] = await pushValues(mapStack, fn);

        [mapStack, accum] = pop(mapStack);

        return [mapStack, accum];
    }, Promise.resolve([mapStack, accum]));


    return [stack, accum];
}

export function onUnique<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let val;
    [stack, val] = pop(stack);
    let array = unpackStackValueR(val, SType.List);
    return [stack, [SType.List, [...new Set([...array].sort())].map(v => [SType.Value, v])]];
}

export function onPush<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let lv, rv;
    [stack, rv] = pop(stack);
    [stack, lv] = pop(stack);

    let list = unpackStackValue(lv, SType.List);

    // Log.debug('[onPush]', list, rv );

    list = [...list, rv];

    return [stack, [SType.List, list]];
}

export function onPop<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let lv;
    [stack, lv] = pop(stack);

    let list = unpackStackValue(lv, SType.List);
    const len = list.length;
    if (len === 0) {
        throw new StackError('stack underflow');
    }
    let value = list[len - 1];
    return [stack, value];
}





export function onSwap<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let left, right;
    [stack, left] = pop(stack);
    [stack, right] = pop(stack);

    stack = pushRaw(stack, left);
    stack = pushRaw(stack, right);

    return [stack];
}

export function onDrop<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    [stack] = pop(stack);
    return [stack];
}


export function onClear<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    stack = { ...stack, items: [] };
    // [stack,val] = push( stack, [SType.Value, '1.0.0'] );
    return [stack];
};

export async function onVersion<QS extends QueryStack>(stack: QS, val: StackValue): AsyncInstResult<QS> {
    [stack, val] = await push(stack, [SType.Value, '1.0.0']);
    return [stack, val, false];
};

export function onEquals<QS extends QueryStack>(stack: QS, val: StackValue): InstResult<QS> {
    let left, right;
    [stack, left] = pop(stack);
    [stack, right] = pop(stack);

    let equal = compareValues(left, right);
    // Log.debug('[==]', left, right );

    return [stack, [SType.Value, equal]];
}

export function onAssertType<QS extends QueryStack>(stack: QS): InstResult<QS> {
    let value: StackValue;
    // Log.debug('well shit', stack.items );
    [stack, value] = pop(stack);
    let type = unpackStackValue(value, SType.Value);
    value = peek(stack);
    if (value === undefined) {
        throw new Error(`[onAssertType] stack underflow`);
    }
    if (value[0] !== type) {
        throw new Error(`[onAssertType] expected type ${type}, got ${value}`);
    }
    return [stack];
}

// export function onAssert( stack:QueryStack, val:StackValue ):InstResult {
//     // Log.debug('[assert]', val);
//     [stack,val] = pop(stack);
//     assert( val[1], `failed to assert value ${val}` );
//     return [stack];
// }


function isTruthy(value: StackValue): boolean {
    const [type, val] = value;
    if (isBoolean(val)) {
        return val;
    }
    return false;
}

function compareValues(left: StackValue, right: StackValue): boolean {
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return false;
    }
    if (left[0] !== right[0]) {
        return false;
    }
    if (left[1] !== right[1]) {
        return false;
    }
    return true;
}

