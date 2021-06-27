import { StackValue, InstResult, AsyncInstResult, SType, StackError } from '../types';
import { QueryStack } from '../stack';
import { unpackStackValue, unpackStackValueR } from '../util';

const LOOP_OOC = 1000;

export async function onDo(stack: QueryStack, [, op]: StackValue): AsyncInstResult {
    const isSame = op === '?do';
    const start = stack.popValue();
    const end = stack.popValue();
    const expr = unpackStackValue(stack.pop(), SType.List);
    return evalLoop(stack, expr, false, start, end + (isSame ? 0 : 1));
}

/**
 *
 * @param stack
 * @param param1
 */
export async function onLoop(stack: QueryStack, [, op]: StackValue): AsyncInstResult {
    const expr = unpackStackValue(stack.pop(), SType.List);
    return evalLoop(stack, expr);
}

async function evalLoop(
    stack: QueryStack,
    expr: StackValue[],
    exitOnNonTrue = true,
    start = 0,
    end: number = LOOP_OOC,
) {
    let count = start;
    let isLooping = true;
    let result: StackValue = undefined;
    const wasActive = stack.isActive;

    while (count < end && isLooping) {
        stack.addUDWord('i', [SType.Value, count]);

        await stack.pushValues(expr);

        if (exitOnNonTrue) {
            result = stack.size > 0 ? stack.pop() : undefined;
        }

        // log( 'count', count, result );
        // log('result:', result );//, 'out', out );

        if (stack.isActive === false) {
            // bit of a hack - mostly because we are
            // looping on the main stack and not creating a substack

            isLooping = false;
            if (wasActive) {
                stack.isActive = true;
            }
            break;
        }
        // if there is nothing on the stack, safest
        // to exit
        if (exitOnNonTrue && result === undefined) {
            isLooping = false;
        } else {
            isLooping = exitOnNonTrue ? result[1] === true : true;
        }

        count++;
    }

    if (count === LOOP_OOC) {
        throw new StackError(`loop out of control ${count} > ${end}`);
    }

    return result;
}

const log = (...args) => console.log('[onLoop]', ...args);
