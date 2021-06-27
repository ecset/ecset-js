import { StackError, StackValue, SType } from './types';
import { getComponentId } from '../component';
import { getEntityId } from '../entity';
import { stringify } from '@odgn/utils';
import { isStackValue, QueryStack } from './stack';
import { BitField, isBitField, toValues as bfToValues } from '@odgn/utils/bitfield';
import { EntitySet } from '../entity_set';
import { ComponentDef, ComponentDefId, getDefId } from '../component_def';

export interface ToStringOptions {
    flat?: boolean;
}

export function stackToString(stack: QueryStack, reverse = true, items: StackValue[] = undefined): string {
    items = items ?? stack.items;
    const strs = items.map((val) => valueToString(val));
    if (reverse) {
        strs.reverse();
    }
    return strs.join(' ');
}

export function valueToString(val: StackValue, listToString = false, ignoreWhiteSpace = false): string {
    if (!Array.isArray(val)) {
        return val as any;
    }
    const [type, value] = val;
    const whitespaceCheck = /\s+/;

    // Log.debug('[valueToString]', type, value);
    switch (type) {
        case SType.EntitySet:
            return `${type}.${value.type}`; //(${value.esSize(value)})`;
        case SType.ComponentAttr:
            return `(${type}, ${stringify(value)})`;
        case SType.ComponentDef:
            return `(${type} ${value.url})`;
        case SType.Component:
            if (Array.isArray(value)) {
                return `[ ${stringValueToString(type)},` + value.map((v) => stringify(v)).join(', ') + ']';
            }
            return `(${type} ${getComponentId(value)})`;
        case SType.Entity:
            if (Array.isArray(value)) {
                return `(${type} ${stringify(value)})`;
            }
            return String(getEntityId(value));
        case SType.List:
            if (listToString) {
                return value.map((v) => valueToString(v, false, true)).join(' ');
            }
            return `[ ` + value.map((v) => valueToString(v)).join(' ') + ' ]';
        case SType.Map:
            return (
                '{ ' +
                Object.keys(value)
                    .reduce((res, key) => {
                        return [...res, `${stringValueToString(key)}: ${valueToString(value[key])}`];
                    }, [])
                    .join(' ') +
                ' }'
            );
        case SType.Value:
            return stringValueToString(value, ignoreWhiteSpace);
        // return JSON.stringify(value);
        case SType.Filter:
            const [op, left, right] = value;
            return `${op} ${valueToString(left)} ${valueToString(right)}`;
        // case SType.Undefined:
        //     return `undefined`;
        case SType.Regex:
            return '~r/' + value.toString() + '/';
        case SType.DateTime:
            return '~d|' + value.toISOString() + '|';
        default:
            return val.length === 2 ? `(${type}, ${stringify(value)})` : stringify(val);
    }
}

function stringValueToString(value: string, ignoreWhiteSpace = false) {
    const whitespaceCheck = /\s+/;
    return !ignoreWhiteSpace && whitespaceCheck.test(value) ? stringify(value) : value;
}

/**
 *
 * @param val
 * @param assertType
 * @param recursive
 */
export function unpackStackValue(val: StackValue, assertType: SType | SType[] = SType.Any, recursive = false): any {
    if (!Array.isArray(val)) {
        // console.log('[unpackStackValue]', val);
        return val;
    }
    const [type, value] = val;
    if (!Array.isArray(assertType)) {
        assertType = [assertType];
    }

    if (assertType.indexOf(SType.Any) === -1 && assertType.indexOf(type) === -1) {
        throw new StackError(`expected type ${assertType}, got ${type}`);
    }

    switch (type) {
        case SType.List:
            // console.log('[unpackStackValue]', type, value);
            return recursive ? value.map((av) => unpackStackValue(av, SType.Any, true)) : value;
        case SType.Map:
            return recursive
                ? Object.keys(value).reduce((res, key) => {
                      const val = value[key];
                      return { ...res, [key]: isStackValue(val) ? unpackStackValue(val, SType.Any, true) : val };
                  }, {})
                : value;
        case SType.Value:
        case SType.Any:
        case SType.Entity:
        case SType.EntitySet:
        case SType.BitField:
        case SType.Component:
        case SType.Word:
        case SType.Filter:
        case SType.ComponentAttr:
        case SType.ComponentDef:
        case SType.Regex:
        case SType.DateTime:
            return value;
        default:
            return val;
    }
}

/**
 *
 * @param val
 * @param assertType
 */
export function unpackStackValueR(val: StackValue, assertType: SType = SType.Any) {
    return unpackStackValue(val, assertType, true);
}

/**
 * Takes a bitfield and returns an array of defs corresponding
 *
 * @param bf
 * @param asDefIds
 * @returns
 */
export function getComponentDefsFromBitField(
    es: EntitySet,
    bf?: BitField | 'all',
    asDefIds = false,
): ComponentDef[] | ComponentDefId[] {
    if (bf === undefined || bf === 'all' || (isBitField(bf) && bf.isAllSet)) {
        const defs = es.componentDefs.filter(Boolean);
        return asDefIds ? defs.map((d) => getDefId(d)) : defs;
    }

    const dids = bfToValues(bf);
    return asDefIds ? dids : dids.map((d) => es.getByDefId(d));
}
