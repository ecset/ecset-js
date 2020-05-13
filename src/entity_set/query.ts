import { EntityId, EntityList, createEntityList, createBitfield, isEntityList, Entity, getEntityId, isEntity } from "../entity";
import { ComponentId, ComponentList, toComponentId, isComponentList, createComponentList, fromComponentId, Component, isComponent, getComponentDefId, getComponentEntityId } from "../component";
import { BitField } from "odgn-bitfield";
import { EntitySet, EntitySetMem, getEntity, getComponent, isEntitySet } from ".";
import { createLog } from "../util/log";
import { isObject, isInteger, isString, isBoolean } from "../util/is";
import { MatchOptions } from '../constants';
import {
    resolveComponentDefIds, getByDefId
} from "./registry";
import { Type as EntityT } from '../entity';
import { getComponentId } from '../component';
import {
    create as createStack,
    SType,
    addWords,
    pushValues,
    QueryStack,
    StackValue,
    InstResult, AsyncInstResult,
    push, pop, peek, pushRaw,
    findV,
    find as findValue,
    StackError,
    isStackValue,
    DLog,
} from "../query/stack";
import { unpackStackValue, unpackStackValueR, onPluck, onFilter, onDefine } from "../query/words";
import { stackToString } from "../query/util";
import { ComponentDef, ComponentDefId, getDefId } from "../component_def";
import { onLogicalFilter, parseFilterQuery } from './filter';

const Log = createLog('ESMemQuery');


interface ESMemQueryStack extends QueryStack {
    es: EntitySetMem
}

/**
 * 
 * @param es 
 * @param query 
 */
export async function select(es: EntitySetMem, query: StackValue[], options = {} ): Promise<StackValue[]> {
    let stack = createStack() as ESMemQueryStack;
    stack.es = es;
    if( 'stack' in options ){
        stack._root = stack._parent = options['stack'];
    }
    
    // add first pass words
    stack = addWords<ESMemQueryStack>(stack, [
        ['!bf', buildBitfield, SType.Array],
        ['!bf', buildBitfield, SType.Value],
        ['!ca', onComponentAttr],
        ['define', onDefine],
        
        ['and', onLogicalFilter, SType.Any, SType.Any],
        ['or', onLogicalFilter, SType.Any, SType.Any],
        ['not', onLogicalFilter, SType.Any, SType.Any],
        ['==', onLogicalFilter, SType.Any, SType.Any],
        ['!=', onLogicalFilter, SType.Any, SType.Any],
    ]);


    // Log.debug('[select]', query );

    [stack] = await pushValues(stack, query);

    // reset stack items and words
    let {items} = stack;
    stack.items = [];
    stack.words = {};


    stack = addWords<ESMemQueryStack>(stack, [
        ['@e', fetchEntity],
        ['@c', fetchComponents],
        ['!fil', applyFilter, SType.Filter],

        ['limit', applyLimit],
        ['pluck', onPluck],
    ]);

    // make sure any filter values have a following cmd
    items = items.reduce( (result, value, ii, items) => {
        if( value[0] === SType.Filter ){
            return [...result, value, '!fil'];
        }
        return [...result,value];
    },[]);

    // Log.debug('pushing ', items);
    [stack] = await pushValues(stack, items);

    // Log.debug('[select]', stackToString(stack) );


    return stack.items;
}


export function applyFilter(stack:ESMemQueryStack): InstResult<ESMemQueryStack> {
    let filter;
    const {es} = stack;
    [stack, [,filter]] = pop(stack);
    
    // DLog(stack._root, 'bugger', filter);
    // ilog(filter);
    let result = parseFilterQuery( es, filter[0], filter[1], filter[2] );

    
    let eids = walkFilterQuery( es, Array.from(es.entities.keys()), ...result ).sort();
    // ilog( eids );

    return [stack, [SType.Array,eids.map(eid => [SType.Entity,eid])] ];
}

function walkFilterQuery( es:EntitySetMem, eids:EntityId[], cmd?, ...args ){
    if( cmd === 'and' ){
        let left = walkFilterQuery( es, eids, ...args[0] );
        if( left === undefined || left.length === 0 ){
            return left;
        }

        // if there are no results, then return
        let right = walkFilterQuery(es, left, ...args[1] );
        return right;
    }
    else if( cmd === 'or' ){
        let left = walkFilterQuery( es, eids, ...args[0] );
        let right = walkFilterQuery( es, eids, ...args[1] );

        // merge the results and return
        return [...new Set([...left ,...right])];
    }
    else if( cmd === '==' ){
        let {def} = args[0];
        const did = getDefId(def);
        let [key,val] = args[1];
        eids = matchEntities(es, eids, new BitField([did]));
        eids = eids.reduce( (out,eid) => {
            const cid = toComponentId(eid,did);
            const com = es.components.get(cid);
            // Log.debug('[walkFQ]','==', key, com[key], val);
            // if the value is an array, we look whether it exists
            if( Array.isArray(val) ){
                return val.indexOf( com[key] ) !== -1 ? [...out,eid] : out;
            }
            // otherwise a straight compare
            return com[key] === val ? [...out,eid] : out;
        },[]);

        // Log.debug('[walkFQ]', def.uri, key, '==', val);
        return eids;
    } else {
        Log.debug('[walkFQ]', `unhandled ${cmd}`);
        return eids;
    }
}


export function applyLimit(stack: ESMemQueryStack): InstResult<ESMemQueryStack> {
    let limit, offset;
    [stack, limit] = pop(stack);
    [stack, offset] = pop(stack);

    return [stack];
}

export function fetchValue(stack: ESMemQueryStack): InstResult<ESMemQueryStack> {
    let arg: StackValue;
    [stack, arg] = pop(stack);
    let type = arg[0];
    let value;

    if (type === SType.Array) {
        value = unpackStackValue(arg);
        value = value.map(v => [SType.Value, v]);
        value = [SType.Array, value];
    }

    return [stack, value];
}

function popBitField<ST extends QueryStack>(stack:ST): [ST,ComponentDefId[]]{
    const {es} = stack;
    let val;
    let dids:ComponentDefId[];
    val = peek(stack);

    let [type, bf] = val;
    if( type === SType.Bitfield ){
        dids = bf.toValues();
    } else if( type === SType.Value && bf === 'all' ){
        dids = [];
    }
    if( dids !== undefined ){
        [stack] = pop(stack);
    }
    return [stack,dids];
}


export function fetchComponents(stack: ESMemQueryStack): InstResult<ESMemQueryStack> {
    const {es} = stack;
    let left: StackValue;
    let eids:EntityId[];
    let dids:ComponentDefId[];
    let coms = [];

    // get the bitfield
    [stack, dids] = popBitField(stack);

    
    left = peek(stack);

    if( left !== undefined ){
        let from;
        [stack,from] = pop(stack);
        if( from[0] === SType.Entity ){
            eids = [unpackStackValueR(from)];
        } else if( from[0] === SType.Array ){
            eids = from[1].map( it => {
                // Log.debug('[fetchComponent]', from[1]);            
                return isStackValue(it) ? getEntityId(it[1])
                : isEntity(it) ? getEntityId(it) : undefined;
            }).filter(Boolean);
        } else {
            Log.debug('[fetchComponent]', 'unhandled', from);
        }
    }

    // Log.debug('[fetchComponent]', dids, eids );

    coms = Array.from( es.components.values() );
    if( dids !== undefined && dids.length > 0 ){
        coms = coms.filter(com => dids.indexOf( getComponentDefId(com) ) !== -1 );
    }

    if( eids !== undefined && eids.length > 0 ){
        coms = coms.filter(com => eids.indexOf( getComponentEntityId(com)) !== -1 );
    }

    coms = coms.map(c => [SType.Component, c]);
   
    return [stack, [SType.Array, coms]];
}


/**
 * Builds a ComponentAttr value - [Bitfield,string]
 * 
 * @param es 
 * @param stack 
 */
export function onComponentAttr(stack: ESMemQueryStack): InstResult<ESMemQueryStack> {
    const {es} = stack;
    let left, right: StackValue;
    [stack, right] = pop(stack);
    [stack, left] = pop(stack);

    let attr = unpackStackValue(right, SType.Value);
    // let did = unpackStackValue(left, SType.Value);
    let dids = unpackStackValue(left, SType.Any);
    dids = isString(dids) ? [dids] : dids;

    let bf = resolveComponentDefIds(es, dids );

    if( bf.size() === 0 ){
        throw new StackError(`def not found: ${left}`);
    }


    return [stack, [SType.ComponentAttr, [bf, attr]]];
}

export function buildBitfield(stack: ESMemQueryStack): InstResult<ESMemQueryStack> {
    const {es} = stack;
    let arg: StackValue;
    [stack, arg] = pop(stack);

    let dids = unpackStackValueR(arg, SType.Any);

    dids = isString(dids) ? [dids] : dids;

    // Log.debug('[buildBitField]', dids);

    let bf = resolveComponentDefIds(es, dids);

    return [stack, [SType.Bitfield, bf]];
}

/**
 * Fetches an entity instance
 * 
 * @param es 
 * @param stack 
 */
export function fetchEntity(stack: ESMemQueryStack): InstResult<ESMemQueryStack> {
    const {es} = stack;
    let data: StackValue;
    [stack, data] = pop(stack);

    let eid = unpackStackValueR(data, SType.Any);
    let bf: BitField;
    let eids: number[];

    // Log.debug('[fetchEntity]', 'eh?', data);

    if (data[0] === SType.Bitfield) {
        bf = eid as BitField;
        eids = matchEntities(es, undefined, bf);
    } else if (isInteger(eid)) {
        let e = getEntity(es,eid,false);
        // Log.debug('[fetchEntity]', es.entities);
        if (e === undefined) {
            return [stack, [SType.Value, false]];
        }
        return [stack, [SType.Entity, eid]];
    }
    else if( Array.isArray(eid) ){
        eids = eid;
    }
    else if (data[0] === SType.Array) {
        let arr = unpackStackValue(data, SType.Array, false);
        eids = arr.map(row => entityIdFromValue(row)).filter(Boolean);
    }
    else {
        throw new StackError(`@e unknown type ${data[0]}`)
    }

    let result = eids.map(eid => getEntity(es,eid, false) )
    .map(eid => eid === undefined ? [SType.Value, false] : [SType.Entity,eid]);

    return [stack, [SType.Array, result]];
}

function entityIdFromValue( value:StackValue ):EntityId {
    const [type,val] = value;
    switch( type ){
        case SType.Entity:
        case SType.Component:
            return getEntityId(val);
        case SType.Value:
            return isInteger(val) ? val : undefined;
        default:
            return undefined;
    }
}

function matchEntities(es:EntitySetMem, eids: EntityId[], mbf: BitField): EntityId[] {
    let matches: number[] = [];
    const isAll = BitField.isAllSet(mbf);// bf.toString() === 'all';
    if( isAll ){
        return eids !== undefined ? eids : Array.from(es.entities.keys());
    }
    if( eids === undefined ){
        // let es = from as EntitySetMem;
        for (let [eid, ebf] of es.entities) {
            if (BitField.and(mbf, ebf)) {
                matches.push(eid);
            }
        }
    } else {
        for( let ii=0;ii<eids.length;ii++ ){
            let eid = eids[ii];
            let ebf = es.entities.get(eid);
            if( BitField.and( mbf, ebf) ){
                matches.push(eid);
            }
        }
    }
    return matches;
}



// function matchEntitiesII(es: EntitySetMem, mbf: BitField): EntityList {
//     let matches = [];
//     // let entities = new Map<number,BitField>();
//     // let {returnEntities, limit} = options;
//     // limit = limit !== undefined ? limit : Number.MAX_SAFE_INTEGER;

//     const isAll = BitField.isAllSet(mbf);// mbf.toString() === 'all';
//     for (let [eid, ebf] of es.entities) {
//         if (isAll || BitField.and(mbf, ebf)) {
//             matches.push(eid);
//         }
//     }
//     return createEntityList(matches, mbf);
// }

function ilog(...args){
    const util = require('util');
    console.log( util.inspect( ...args, {depth:null} ) );
}