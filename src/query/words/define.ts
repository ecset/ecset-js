import { StackValue, InstResult, AsyncInstResult, SType, StackError } from '../types';
import { QueryStack } from '../stack';
import { isNumeric, isString, parseUri } from '@odgn/utils';
import { unpackStackValueR } from '../util';

/**
 * define and let words
 *
 * a define value will be evaluated when it is pushed onto the stack
 *
 * a let value will just be pushed onto the stack
 *
 * @param stack
 * @param param1
 */
export function onDefine(stack: QueryStack, [, op]: StackValue): InstResult {
    let wordFn;
    const wordVal = stack.pop();

    const [valType, value] = stack.pop();
    const [, word] = wordVal;

    if (word === undefined) {
        throw new StackError('undefined word');
    }

    const isDefine = op === 'define';

    if (valType === SType.List && isDefine) {
        wordFn = [SType.Word, value];
    } else if (isString(value) && isDefine) {
        const { protocol, host, path } = parseUri(value);
        // console.log('ok', {protocol,host,path});

        if (protocol === 'js') {
            const module = global[host];
            const fn = module[path.substring(1)];
            const arity = fn.length;
            wordFn = async (stack: QueryStack): AsyncInstResult => {
                const args = [];
                for (let ii = 0; ii < arity; ii++) {
                    args.push(unpackStackValueR(stack.pop()));
                }
                // console.log(`[${host}][${path.substring(1)}]`, args);
                const result = await fn.apply(null, args);
                return [SType.Value, result];
            };
        } else if (protocol === 'nodejs') {
            // console.log('nodejs', 'require', `"${host}"` );
            const module = require(host);
            const fn = module[path.substring(1)];
            const arity = fn.length;

            // console.log('found', path, arity );
            wordFn = async (stack: QueryStack): AsyncInstResult => {
                const args = [];
                for (let ii = 0; ii < arity; ii++) {
                    args.push(unpackStackValueR(stack.pop()));
                }
                const result = await fn.apply(null, args);
                // console.log('apply', args, result);
                return [SType.Value, result];
            };
        }
    } else {
        wordFn = [valType, value];
    }

    if (isDefine) {
        stack.addWords([[word, wordFn]]);
    } else {
        stack.addUDWord(word, wordFn);
    }

    return undefined;
}

export function onFetchWord(stack: QueryStack): InstResult {
    const word = stack.popValue();
    const val = stack.getUDWord(word);
    return val;
}
