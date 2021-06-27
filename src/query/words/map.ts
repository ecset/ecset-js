import { onUnexpectedError } from '.';
import { QueryStack } from '..';
import { InstResult, StackValue, SType } from '../types';
import { unpackStackValue } from '../util';
import { onListOpen } from './list';

export function onMapOpen(stack: QueryStack): InstResult {
    // Log.debug('[onMapOpen]', stack.items);//Object.keys(stack.words));

    const sub = stack.setChild();

    // add something which will interpret each push
    sub.addWords(
        [
            ['{', onMapOpen],
            ['[', onListOpen],
            ['}', onMapClose],
            [']', onUnexpectedError],
        ],
        true,
    );
    // throw 'stop';
    // (sub as any)._stack = stack;
    // Log.debug('[onMapOpen]', {id:sub.id, parent:stack.id});
    return undefined;
}

export function onMapClose<QS extends QueryStack>(stack: QS, val: StackValue): InstResult {
    // if( stack.id === 158 ){
    //     Log.debug('[onMapClose]', {id:stack.id, parent:stack._parent?.id}, stackToString(stack) );
    //     Log.debug('[onMapClose]', stack);
    // }

    const map = stack.items.reduce((result, val, idx, array) => {
        if (idx % 2 === 0) {
            const key = unpackStackValue(val);
            const mval = array[idx + 1];
            // console.log('key!', key, array);
            result[key] = mval === undefined ? [SType.Value, undefined] : mval;
        }
        return result;
    }, {});
    val = [SType.Map, map];
    // Log.debug('[onMapClose]', {id:stack.id, parent:stack._parent.id});
    // stack = stack._parent;
    stack.restoreParent();
    return val;
}
