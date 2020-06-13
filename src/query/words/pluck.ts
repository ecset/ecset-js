import { SType, StackError, AsyncInstResult } from "../types";
import { unpackStackValue, unpackStackValueR } from "../util";
import { isObject } from "../../util/is";
import { isStackValue, QueryStack } from "../stack";
import Jsonpointer from 'jsonpointer';


export async function onPluck(stack: QueryStack): AsyncInstResult {
    let right = stack.pop();
    let left = stack.pop();

    let key = unpackStackValueR(right, SType.Any);
    let list = unpackStackValue(left, [SType.List, SType.Map]);

    if (isObject(list)) {
        list = [[SType.Map, list]];
    }


    let out:any[] = [];
    if (Array.isArray(key)) {
        
        for( const it of list ){
            let obj = unpackStackValue(it);
            
            if (!isObject(obj)) {
                throw new StackError(`expected map, got ${it[0]}`);
            }

            // console.log('well', key, Object.keys(obj) );

            let result = {};
            for( const ptr of key ){
                // console.log('set', ptr, Jsonpointer.get(obj,ptr) );
                Jsonpointer.set(result, ptr, Jsonpointer.get(obj,ptr) );
                // console.log('set', result);
            }
            // const val = Object.keys(obj).filter(k => key.indexOf(k) !== -1)
            //     .reduce((acc, key) => Object.assign(acc, { [key]: obj[key] }), {});

            out.push( [SType.Map, result] );
        }
    }
    else {
        

        for( const it of list ){
            let obj = unpackStackValue(it);
            if (!isObject(obj)) {
                throw new StackError(`expected map, got ${it[0]}`);
            }
            let val = Jsonpointer.get(obj,key);// obj[key];
            out.push( isStackValue(val) ? val : [SType.Value, val] );
        }
    }

    // console.log('[onPluck]', out);
    return [SType.List, out];
}
