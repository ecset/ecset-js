import { QueryStack } from '..';
import { isBoolean } from '@odgn/utils';
import { AsyncInstResult, InstResult, StackError, StackValue, SType } from '../types';

export function compareDates(op: string, dateA: Date, dateB: Date) {
    const timeA = dateA.getTime();
    const timeB = dateB.getTime();
    switch (op) {
        case '==':
            return timeA === timeB;
        case '!=':
            return timeA !== timeB;
        case '>':
            return timeA > timeB;
        case '>=':
            return timeA >= timeB;
        case '<':
            return timeA < timeB;
        case '<=':
            return timeA <= timeB;
        default:
            return false;
    }
}

export function isTruthy(value: StackValue): boolean {
    const [type, val] = value;
    if (isBoolean(val)) {
        return val;
    }
    return false;
}

export function compareValues(left: StackValue, right: StackValue): boolean {
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

export function onArgError(stack: QueryStack, val: StackValue): InstResult {
    throw new StackError('invalid argument');
}
