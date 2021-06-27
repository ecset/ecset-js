import { QueryStack } from '../stack';
import { StackValue, InstResult, AsyncInstResult, SType } from '../types';

/**
 * <else> <then> <condition> iif
 *
 */
export async function onCondition(stack: QueryStack, [, op]: StackValue): AsyncInstResult {
    const isIfElse = op !== 'if';
    const condVal = stack.pop();
    const ifVal = stack.pop();
    const elseVal = isIfElse ? stack.pop() : undefined;
    const condition = condVal[1];

    // console.log('[onCondition]', condVal, ifVal, elseVal );

    // if( condition ){
    //     console.log('[onCondition]', 'result', ifVal );
    // } else {
    //     console.log('[onCondition]', 'result', elseVal );
    // }

    if (isIfElse) {
        // await stack.push( condition ? ifVal : elseVal );
        await pushValue(stack, condition ? ifVal : elseVal);
    } else if (condition) {
        // console.log('[onCondition]', ifVal );
        // console.log('[onCondition]', op, stack.toString() );
        // await stack.push( ifVal );
        await pushValue(stack, ifVal);
        // console.log('[onCondition]', 'post', op, stack.toString() );
    }

    return undefined;
}

async function pushValue(stack: QueryStack, value: StackValue) {
    if (value[0] === SType.List) {
        await stack.pushValues(value[1]);
    } else {
        return stack.push(value);
    }
}

export async function onLogicalOp(stack: QueryStack, [, op]: StackValue): AsyncInstResult {
    const left = stack.popValue();
    const right = stack.popValue();

    if (op === 'and') {
        return [SType.Value, left && right];
    }
    if (op === 'or') {
        return [SType.Value, left || right];
    }
    if (op === '??') {
        return [SType.Value, left ?? right];
    }

    return undefined;
}
