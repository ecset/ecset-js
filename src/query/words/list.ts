import { onUnexpectedError } from '.';
import { QueryStack } from '..';
import { isEqual, isInteger } from '@odgn/utils';
import { AsyncInstResult, InstResult, StackError, StackValue, SType } from '../types';
import { unpackStackValue, unpackStackValueR } from '../util';
import { onMapOpen } from './map';
import { isTruthy } from './util';

export function onListOpen(stack: QueryStack): InstResult {
    const sub = stack.setChild();

    sub.addWords(
        [
            ['{', onMapOpen],
            ['[', onListOpen],
            [']', onListClose],
            ['}', onUnexpectedError],
        ],
        true,
    );
    sub.isUDWordsActive = false;
    sub.isEscapeActive = false;
    // Log.debug('[onListOpen]', 'stack', stack._idx, stack.isUDWordsActive, 'sub', sub._idx, sub.isUDWordsActive );

    return undefined;
}

export function onListClose<QS extends QueryStack>(stack: QS): InstResult {
    // Log.debug('[onListClose]', stack );
    const val: StackValue = [SType.List, stack.items];
    stack.restoreParent();
    return val;
}

export function onListFetch<QS extends QueryStack>(stack: QS, val: StackValue): InstResult {
    const left = stack.pop();
    const right = stack.pop();
    const arr = unpackStackValue(right, SType.List);
    const idx = unpackStackValue(left, SType.Value);
    return isInteger(idx) ? arr[idx] : [SType.Value, false];
}

/**
 *
 * @param stack
 * @param val
 */
export function onAddList<QS extends QueryStack>(stack: QS, val: StackValue): InstResult {
    const left = stack.pop();
    const right = stack.pop();

    // let arr = right[0] === SType.List
    const [ltype, lval] = left;
    const [rtype, rval] = right;
    let result = rval;
    // let resultType = rtype;

    if (rtype === SType.List) {
        if (ltype === SType.List) {
            result = [...result, ...lval];
        } else {
            result = [...result, left];
        }
    }
    // left value being a list is a prepend
    else if (ltype === SType.List) {
        result = lval;
        result = [right, ...result];
    }
    // console.log('[onAddList]', result);
    return [SType.List, result];
}

export async function onListSpread<QS extends QueryStack>(stack: QS): AsyncInstResult {
    const val = stack.pop();
    const value = unpackStackValueR(val, SType.List).map((v) => [SType.Value, v]);

    // Log.debug('[onArraySpread]', value);
    await stack.pushValues(value);
    return undefined;
}

/**
 * By default, values in a list are not evaluated against defined words
 * this function takes a list and allows each value to be evaluated
 *
 * @param stack
 */
export async function onListEval<QS extends QueryStack>(stack: QS): AsyncInstResult {
    const val = stack.pop();
    const list = unpackStackValue(val, SType.List);

    return evalList(stack, list);
}

/**
 *
 * @param stack
 * @param list
 */
export async function evalList<QS extends QueryStack>(stack: QS, list: StackValue[]): AsyncInstResult {
    const mapStack = stack.setChild(stack);

    await mapStack.pushValues(list);
    // for (const val of list) {
    //     // console.log('[evalList]', val, mapStack.isEscapeActive);
    //     await mapStack.push(val);
    // }

    const result = mapStack.items;
    stack.restoreParent();

    return [SType.List, result];
}

/**
 * Creates an array from the values on the stack, providing they are of the
 * same type
 *
 * @param stack
 * @param val
 */
export function onGather<QS extends QueryStack>(stack: QS, val: StackValue): InstResult {
    let values: StackValue[];
    const first = stack.pop();
    const type: SType = first[0];

    values = stack.popOfType(type);

    values = [...values.reverse(), first];

    return [SType.List, values];
}

/**
 * Concats list values, or a value to a list
 * @param stack
 * @param val
 */
export function onConcat<QS extends QueryStack>(stack: QS, val: StackValue): InstResult {
    const a = stack.pop();
    let b = stack.pop();

    // Log.debug('[onConcat]', 'a:', a[0], 'b:', b );
    b = b[0] !== SType.List ? [b] : b[1];

    const values = [].concat(b, a[1]);

    return [SType.List, values];
}

export async function onFilter<QS extends QueryStack>(stack: QS): AsyncInstResult {
    let fn: StackValue = stack.pop();
    let list = stack.pop();

    list = unpackStackValue(list, SType.List);
    const isListFn = fn[0] === SType.List;
    fn = unpackStackValue(fn);

    const mapStack = stack.setChild(stack);
    let accum = [];

    for (const val of list) {
        await mapStack.push(val);
        if (isListFn) {
            await mapStack.pushValues(fn as any);
        } else {
            await mapStack.push(fn);
        }

        // Log.debug('[onFilter]', 'end', mapStack.items );
        const out = mapStack.pop();
        if (isTruthy(out)) {
            accum = [...accum, val];
        }
    }

    stack.restoreParent();

    return [SType.List, accum];
}

export async function onMap<QS extends QueryStack>(stack: QS): AsyncInstResult {
    const right = stack.pop();
    const left = stack.pop();

    const list = unpackStackValue(left, SType.List);
    const isListFn = right[0] === SType.List;
    const fn = unpackStackValue(right);

    // console.log('[onMap]', 'list', list);
    // console.log('[onMap]', 'fn', fn);

    const mapStack = stack.setChild(stack);

    for (const val of list) {
        // console.log('[onMap]', 'li', val);
        await mapStack.push(val);
        if (isListFn) {
            await mapStack.pushValues(fn);
        } else {
            await mapStack.push(fn);
        }
    }

    const result = mapStack.items;
    stack.restoreParent();

    return [SType.List, result];
}

export async function onReduce<QS extends QueryStack>(stack: QS): AsyncInstResult {
    const right = stack.pop();
    let accum = stack.pop();
    const left = stack.pop();

    const list = unpackStackValue(left, SType.List);
    const isListFn = right[0] === SType.List;
    const fn = unpackStackValue(right);

    const mapStack = stack.setChild(stack);

    for (const val of list) {
        await mapStack.push(val);
        await mapStack.push(accum);
        if (isListFn) {
            await mapStack.pushValues(fn);
        } else {
            await mapStack.push(fn);
        }

        accum = mapStack.pop();
    }
    stack.restoreParent();

    return accum;
}

/**
 * ( %[] -- %[] )
 * @param stack
 */
export function onUnique<QS extends QueryStack>(stack: QS): InstResult {
    const val = stack.pop();
    const array = unpackStackValueR(val, SType.List);
    return [SType.List, [...new Set([...array].sort())].map((v) => [SType.Value, v])];
}

/**
 *
 * @param stack
 * @param param1
 */
export function onDiff(stack: QueryStack, [, op]: StackValue): InstResult {
    const isDiff = op === 'diff' || op === 'diff!';
    const isInter = op === 'intersect' || op === 'intersect!';
    const isUnion = op === 'union' || op === 'union!';
    const isDes = op.endsWith('!');

    const left = isDes ? stack.pop() : stack.peek();
    const right = isDes ? stack.pop() : stack.peek(1);

    const ta = left[0];
    const tb = right[0];
    const a = unpackStackValue(left, [SType.List, SType.Map, SType.Component, SType.Entity]);
    const b = unpackStackValue(right, [SType.List, SType.Map, SType.Component, SType.Entity]);

    if (tb !== tb) {
        throw new StackError(`incompatible types ${tb} ${tb}`);
    }

    let out;

    if (ta === SType.List) {
        if (isDiff || isInter) {
            out = a.filter((x) => {
                const idx = b.findIndex((e) => isEqual(e, x));
                return isDiff ? idx === -1 : idx !== -1;
            });
            // return isDiff ? !eq : eq;
        } else if (isUnion) {
            out = [...b];
            for (let ii = 0; ii < a.length; ii++) {
                if (out.findIndex((e) => isEqual(e, a[ii])) === -1) {
                    out.push(a[ii]);
                }
            }
        }
    } else {
        out = [];
    }

    return [SType.List, out];
}

export function onListIndexOf(stack: QueryStack, [, op]: StackValue): InstResult {
    const isDes = op.endsWith('!');
    const left = stack.pop();
    const right = isDes ? stack.pop() : stack.peek();
    const arr = unpackStackValue(right, SType.List);
    const idx = left;

    const result = arr.findIndex(([at, av]) => {
        return at === idx[0] && av === idx[1];
    });

    // console.log('[onListIndexOf]', arr, idx, result );
    return [SType.Value, result];
}
