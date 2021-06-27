import { SType, StackError, AsyncInstResult, StackValue, InstResult } from '../types';
import { unpackStackValue, unpackStackValueR, stackToString } from '../util';
import { toCapitalized } from '@odgn/utils';
import { isObject } from '@odgn/utils';
import { isStackValue, QueryStack } from '../stack';
import Jsonpointer from 'jsonpointer';
import { isComponent } from '../../component';
import { Entity, isEntity } from '../../entity';

export function onPluck(stack: QueryStack, [, op]: StackValue): InstResult {
    // console.log('[onPluck]', stackToString(stack) );
    const isDes = op === 'pluck!';

    const right = stack.pop();
    // let left = stack.pop();
    const left = isDes ? stack.pop() : stack.peek();

    const key = unpackStackValueR(right, SType.Any);
    let list = unpackStackValue(left, [SType.List, SType.Map, SType.Component, SType.Entity]);

    const isInputArray = !isObject(list);
    if (isObject(list)) {
        list = [[SType.Map, list]];
    }

    // console.log('[onPluck]', { key }, { list });

    const out: any[] = [];
    if (Array.isArray(key)) {
        for (const it of list) {
            const obj = unpackStackValue(it);

            if (!isObject(obj)) {
                throw new StackError(`expected map, got ${it[0]}`);
            }

            // console.log('[onPluck]', 'well', key, obj);

            const result = [];

            for (let ii = 0; ii < key.length; ii++) {
                const val = getStackValue(obj, key[ii]);
                result[ii] = val;
            }

            out.push([SType.List, result]);
        }
    } else {
        for (const it of list) {
            const obj = unpackStackValue(it);
            if (!isObject(obj)) {
                throw new StackError(`expected map, got ${it[0]}`);
            }
            const val = getStackValue(obj, key);

            out.push(val);
        }
    }
    if (out.length === 1 && !isInputArray) {
        // !Array.isArray(key)) {
        return out[0];
    }

    // console.log('[onPluck]', out);
    return [SType.List, out];
}

function getStackValue(obj: any, key: string) {
    let val: any;

    if (isEntity(obj)) {
        val = getEntityComponent(obj, key);
        // console.log('[onPluck]', 'get entity', key, val );
    } else {
        val = Jsonpointer.get(obj, key);
    }

    // console.log('[onPluck]', 'get', key, val );
    if (isStackValue(val)) {
        return val;
    }

    if (isComponent(val)) {
        return [SType.Component, val];
    } else if (isEntity(val)) {
        return [SType.Entity, val];
    }

    return [SType.Value, val];
}

/**
 * Returns an entity component or component attribute
 * using a JSON pointer
 * @param e
 * @param ptr
 */
function getEntityComponent(e: Entity, ptr: string) {
    const match = /(^\/component\/(.*))#(.*)/.exec(ptr);

    if (match == null) {
        return Jsonpointer.get(e, ptr);
    }

    let [, , comPtr, attrPtr] = match;

    // NOTE - we are relying on the entity/com def name
    // lookup so we dont have to resolve to a did
    const com = e[toCapitalized(comPtr)];

    if (com === undefined) {
        // console.log('[getEntityComponent]', com, toCapitalized(comPtr), e );
        return undefined;
    }

    // normalise
    if (!attrPtr.startsWith('/')) {
        attrPtr = '/' + attrPtr;
    }

    // console.log('[getEntityComponent]', attrPtr, com );
    return Jsonpointer.get(com, attrPtr);
    // const [ comPtr, attrPtr ] = ptr.split('#');
}
