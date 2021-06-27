import { hash as hashValue } from '@odgn/utils';
import { isObject, isString, isFunction, isInteger } from '@odgn/utils';
import { toCamelCase, toCapitalized } from '@odgn/utils';

export const Type = '@d';
export type ComponentDefId = number;
export type ComponentDefUrl = string;

// export enum PropertyType {
//     String,
//     Integer,
//     Number,
//     Boolean,
//     Array,
//     Binary,
//     JSON, // also an object
//     Entity,
//     BitField,
//     DateTime,
// };

export interface ComponentDef {
    [Type]: number;
    url: string;
    name: string;
    hash: number;
    properties: ComponentDefProperty[];
    additional: Map<string, any>;
}

export interface ComponentDefRaw {
    url: string;
    properties: [];
}

export interface ComponentDefProperty {
    name: string;
    type: PropertyType;
    default: any;
    isDefault?: boolean;
    optional: boolean;
    // whether this property should be persisted in storage
    persist: boolean;
    additional: Map<string, any>;
}

const propertyDefaults = {
    name: undefined,
    type: 'string' as PropertyType,
    default: undefined,
    optional: false,
    persist: true,
};

const typeDefaults = {
    json: {},
    integer: 0,
    entity: 0,
    boolean: false,
    list: [],
    map: {},
    datetime: undefined, // () => new Date()
};

export type PropertyType =
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'entity'
    | 'list'
    | 'map'
    | 'datetime'
    | 'json';

/**
 *
 */
export function create(...args: any[]): ComponentDef {
    if (args.length === 0) {
        throw new Error('invalid create params');
    }

    const first = args[0];
    let params: any = {};

    if (isInteger(first)) {
        params.id = first;
    } else if (isObject(first)) {
        return createFromObj(first);
    } else if (isString(first)) {
        params.name = first;
    }
    // console.log('[create]', params, first );

    const second = args[1];
    if (isString(second)) {
        params.url = second;
    } else if (isObject(second)) {
        params = { ...second, ...params };
    }

    const third = args[2];
    if (Array.isArray(third) || isString(third)) {
        params.properties = third;
    } else if (isObject(third)) {
        params = { ...third, ...params };
    }
    // console.log('[create]', params );

    return createFromObj(params);
}

export function createFromObj({ id, name, url, properties, ...extra }): ComponentDef {
    // # use the provided or extract from the last part of the url
    // name = name || url |> String.split("/") |> List.last() |> Macro.camelize()

    if (extra['@d'] !== undefined) {
        // if( '@d' in extra ){
        // console.log('[createFromObj]', 'have @d', extra['@d']);
        const { ['@d']: did, ...res } = extra;
        id = extra['@d'];
        extra = res;
    }

    if (!name) {
        // console.log('[createFromObj]', 'creating name from', url );
        const parts: string[] = url.split('/').reverse();
        name = toCapitalized(toCamelCase(parts[0]));
    }

    if (isString(properties) || isObject(properties)) {
        properties = [createProperty(properties)];
    } else if (Array.isArray(properties)) {
        // console.log('[createFromObj]', 'creating from obj', url );
        properties = properties.map((prop) => createProperty(prop));
    } else {
        // console.log('but what', properties );
        properties = [];
    }

    const def: any = {
        [Type]: id,
        url,
        name,
        properties,
        additional: new Map<string, any>(),
    };

    def.hash = hash(def as ComponentDef);

    return def as ComponentDef;
}

export function isComponentDef(value: any): boolean {
    return isObject(value) && 'url' in value && 'properties' in value;
}

/**
 * Returns a hashed number for the ComponentDef
 *
 */
export function hash(def: ComponentDef): number {
    return hashValue(JSON.stringify(toObject(def, false)), false) as number;
}

export function hashStr(def: ComponentDef): string {
    return hashValue(JSON.stringify(toObject(def, false)), true) as string;
}

export function getDefId(def: ComponentDef): number {
    return def !== undefined ? def[Type] : undefined;
}

export function getProperty(def: ComponentDef, name: string): ComponentDefProperty {
    return def.properties.find((p) => p.name === name);
}

export interface ComponentDefObj {
    '@d'?: number;
    name?: string;
    url: string;
    properties?: any[];
}

/**
 * Converts the ComponentDef into an object
 */
export function toObject(def: ComponentDef, includeId = true): ComponentDefObj {
    const { [Type]: id, name, url, properties } = def;

    let objProps: any[];

    if (properties) {
        objProps = properties.map((p) => propertyToObject(p, includeId));
    }

    let result: ComponentDefObj = { name, url };
    if (includeId) {
        result['@d'] = id;
    }
    if (objProps?.length > 0) {
        result = { ...result, properties: objProps };
    }
    return result;
}

export function toShortObject(def: ComponentDef) {
    // [ "/component/completed", [{"name":"isComplete", "type":"boolean", "default":false}] ]
    const obj = toObject(def, false);
    return obj.properties ? [obj.url, obj.properties] : [obj.url];
}

/**
 *
 * @param params
 */
export function createProperty(params: any): ComponentDefProperty {
    let name = '';
    const additional = new Map<string, any>();
    let type = propertyDefaults.type;
    let defaultValue = propertyDefaults.default;
    const optional = propertyDefaults.optional;
    let persist = true;
    let isDefault = true;

    if (isString(params)) {
        name = params;
    } else if (isObject(params)) {
        name = params.name || name;
        type = params.type || type;
        persist = params.persist ?? persist;
        const tdef = type === 'datetime' ? undefined : typeDefaults[type] ?? undefined;
        defaultValue = params.default ?? tdef;
        isDefault = params.default === undefined;

        // console.log('but', name, 'type', type, defaultValue, params);

        for (const key of Object.keys(params)) {
            if (key === 'additional') {
                continue;
            }
            if (key in propertyDefaults === false) {
                additional.set(key, params[key]);
            }
        }
    }

    return {
        name,
        type,
        default: defaultValue,
        optional,
        persist,
        additional,
        isDefault,
    };
}

export function propertyToObject(prop: ComponentDefProperty, includeAdditional = true): object {
    const result = {};

    for (const key of Object.keys(propertyDefaults)) {
        if (propertyDefaults[key] == prop[key] || prop[key] === undefined) {
            continue;
        }
        if (key === 'default') {
            if (prop.isDefault || typeDefaults[prop.type] == prop[key]) {
                continue;
            }
            // console.log('[pTo]', key, prop.type, prop[key]);
        }
        result[key] = prop[key];
    }

    if (includeAdditional) {
        for (const [key, value] of prop.additional) {
            result[key] = value;
        }
    }

    // if( Object.keys(result).length === 1 ){
    //     return result[name];
    // }

    return result;
}
