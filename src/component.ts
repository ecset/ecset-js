import { Type as DefT, ComponentDefId } from './component_def';
import { isObject, isString, isInteger } from './util/is';
import { EntityId } from './entity';

export type ComponentProperties = Map<string, any>;

export const Type = '@c';
export const EntityT = '@e';

// made up of entityId,defId
export type ComponentId = string; //[number, number];

export interface ComponentList {
    cids: ComponentId[];
}

export interface OrphanComponent {
    [key: string]: any;
    [DefT]: number | string;
}

export interface Component {
    [key: string]: any; // attributes
    [DefT]: number; // def id
    [EntityT]: number; // entity id
    // props: Map<string, any>;
}

export interface ComponentObj {
    [key: string]: any;
    '@d': number;
    '@e': number;
}


export function create(params:object):Component {

    let result:any = { [DefT]: 0, [EntityT]:0 };
    for( let key of Object.keys(params) ){
        if( key === '@d' ){
            result[DefT] = params['@d'];
        }
        else if( key === '@e' ){
            result[EntityT] = params['@e'];
        }
        else {
            result[key] = params[key];
        }
    }

    // const result = {
    //     [DefT]: 0,
    //     [EntityT]: 0,
    //     ...params,
    // };

    // console.log('[Component][create]', toObject(result) );

    return result;
}

export function createComponentList( cids:ComponentId[] ){
    return { cids };
}

export function isComponentList(value:any):boolean {
    return isObject(value) && 'cids' in value;
}

export function getComponentId( component:Component ): ComponentId {
    return JSON.stringify( [component[EntityT], component[DefT]] );
    // return [component[EntityT], component[DefT]].join(',');
}
export const toComponentId = ( eid:EntityId, did:ComponentDefId ) => JSON.stringify([eid,did]);

export const isComponentId = (val:any) => isString(val);

/**
 * Returns the entityId and defId from a ComponentId
 * @param id 
 */
export function fromComponentId( id:ComponentId ): [EntityId,ComponentDefId] {
    return JSON.parse(id);
}

export function getComponentDefId( component:Component ): ComponentDefId {
    return component[DefT];
}

export function getComponentEntityId( component:Component ): number {
    let eid = component[EntityT];
    return !isInteger(eid) ? 0 : eid;
}

export function setEntityId( component:Component, entityId:number ): Component {
    return {
        ...component,
        [EntityT]: entityId
    };
}

export function toObject( component:Component ): ComponentObj {
    let result = {
        '@d': component[DefT],
        '@e': component[EntityT]
    };
    for( let key of Object.keys(component) ){
        result[key] = component[key];
    }
    return result;
}

export function isComponentLike( item:any ): boolean {
    return isObject(item) && DefT in item;
}

export function isComponent( item:any ): boolean {
    return isObject(item) && DefT in item && EntityT in item;
}

export function isExternalComponent( item:any ): boolean {
    return isObject(item) && isString(item[DefT]);
}

// export class Component {
    
//     constructor(defId: number, entityId: number = 0, properties:ComponentProperties = new Map<string, any>()){
//         this.defId = defId;
//         this.entityId = entityId;
//         this.properties = properties;
//     }


//     get(name:string):any {
//         return this.properties.get(name);
//     }
// }