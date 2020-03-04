import { DslContext, commandFunctions, compileCommands } from './dsl';
import {
    EntityFilterType,
    QueryOp,
} from '../types';
import { isEntity, isEntitySet } from '../util/is';

import { Base } from '../base';
import {BitField} from 'odgn-bitfield';
import { Entity } from '../entity';
import { EntityFilter } from '../entity_filter';
import { EntitySet } from '../entity_set';
import { QueryBuilder } from './dsl';
import { Registry } from '../registry';
import { hash } from '../util/hash';
import { stringify } from '../util/stringify';
import { uniqueID } from '../util/unique_id';

export interface QueryExecuteOptions {
    registry?: Registry;
    debug?:boolean;
    alias?:object;
    context?;
}

function processOptions( options = {} ){
    return options;
}


interface CommandFilterOptions {
    limit?:number;
    offset?:number;
}


export type Builder = (builder:QueryBuilder) => DslContext;

export class Query extends Base {

    commands;

    compiled:Array<any>;

    ast:[];
    

        /**
     *
     */
    static commands(...commands) {
        let result;

        result = new Query();
        result.src = commands.map(command => command.toArray(true)[0]);

        return result;
    };

    // Query.commandBuilder(query,options={}){

    // }



    static isQuery(query) {
        return query && query instanceof Query;
    };

    /**
     * Adhoc execution of a query
     */
    static exec(query, entity, options?) {
        const q = new Query(query);
        return q.execute(entity, options);
    };


    static toQuery(query) {
        if (!query) {
            return null;
        }
        if (Query.isQuery(query)) {
            return query;
        }
        if (typeof query === 'function') {
            return new Query(query);
        }
        return null;
    };


    static build( commands:Builder ){
        let query = new Query();
        let builder = new QueryBuilder(query);
        let result = commands( builder );
        
        query.commands = result.toArray(true);

        return query;
    }

    static fromAST( ast:Array<any> ){
        let query = new Query();
        query.commands = ast;
        return query;
    }

    constructor(commands?, options = {}) {
        super( processOptions(options) );

        this.commands = commands;

        if (typeof commands === 'function') {
            // console.log('compiling a command builder');
            const builder = new QueryBuilder(this);
            const built = commands(builder);
            if (Array.isArray(built)) {
                this.commands = built.map(dsl => dsl.toArray(true)[0]);
            } else {
                this.commands = built.toArray(true);
            }

            // console.log('query builder result', built);
            // commands = commands(builder).toArray(true);
            // console.log('query builder result', commands);
        } else if (commands instanceof Query) {
            this.commands = commands.toJSON();
        } else if (Array.isArray(commands)) {
            if (typeof commands[0] === 'function') {
                const builder = new QueryBuilder(this);
                this.commands = commands.map(cmd => {
                    return cmd(builder).toArray(true)[0];
                });
            }
        }
    }

    getCIDPrefix() : string {
        return 'q';
    }

    isEmpty() {
        return !this.commands || this.commands.length == 0;
    }

    toArray() {
        return this.compiled;
    }

    toJSON() {
        const rep = this.compiled ? this.compiled : this.commands;
        return rep;
    }

    /**
     *
     */
    execute(entity?, options:QueryExecuteOptions = {}) {
        let ii, len, command, context, result;

        // build the initial context object from the incoming arguments
        context = this.buildEntityContext(entity, options);

        // console.log('[Query][execute] go', entity);
        // this.compile( context, this.commands, options );
        this.compiled = compile(context, this.commands, options);

        // if( context.debug ){console.log('commands:'); printIns( query,1 ); }

        console.log('execute', this.commands);
        console.log('compiled', this.compiled );

        for (ii = 0, len = this.compiled.length; ii < len; ii++) {
            command = this.compiled[ii];
            // console.log('go ' + stringify(command) );

            // the actual result will usually be [VALUE,...]
            result = executeCommand(context, command)[1];
        }

        // console.log('execute result was', stringify(result));
        return result;
        // return true;
    }

    /**
     *
     */
    buildEntityContext(entity:Entity|EntitySet, options:QueryExecuteOptions = {}) {
        let context = new QueryContext(this);

        if (isEntitySet(entity)) {
            context.entitySet = <EntitySet>entity;
        } else if (isEntity(entity)) {
            context.entity = <Entity>entity;
        }

        let rootObject = (context.root = context.entity || context.entitySet);

        // console.log('[buildEntityContext]', 'registry', rootObject );

        context.registry = options.registry || (rootObject ? rootObject.getRegistry() : null);

        context.last = [QueryOp.Value, rootObject];

        if (options.debug) {
            context.debug = true;
        }

        if (options.alias) {
            context.alias = { ...options.alias };
        }

        return context;
    }
}




class QueryContext {

    readonly query:Query;

    entitySet?: EntitySet;

    entity?: Entity;

    registry: Registry;

    root;

    last;

    debug;

    alias:object;

    // cid:string;

    // static create(query, props = {}, options:QueryExecuteOptions = {}) {
    //     // let type = options.context || props.type || QueryContext;
    //     let context = new QueryContext(query);
    //     // context.type = type;
    //     // context.cid = uniqueID('qc');
    //     Object.assign(context, props);
    //     return context;
    // };


    constructor(query, context?:QueryContext){
        this.query = query;
        if( context ){
            this.entitySet = context.entitySet;
            this.entity = context.entity;
            this.registry = context.registry;
            this.root = context.root;
            // Object.assign(this, context);
        }
    }

    /**
     *   Returns the referenced value of the passed value providing it is a Query.VALUE
     */
    valueOf(value:any, shouldReturnValue:boolean = false) {
        let command;
        if (!value) {
            return value;
        }
        
        if (Array.isArray(value)) {
            command = value[0];
            if (command === QueryOp.Value) {
                if (value[1] === QueryOp.Root) {
                    return this.root;
                }
                return value[1];
            } else if (command === QueryOp.Root) {
                return this.root;
            }
            if( true ){ console.log('valueOf: cmd ' + command + ' ' + stringify(value) )}
            value = executeCommand(this, value);

            // if( this.debug ){ console.log('valueOf exec: ' + stringify(value) )}

            if (value[0] === QueryOp.Value) {
                return value[1];
            }
        }

        if (shouldReturnValue) {
            return value;
        }

        return null;
    }

    /**
     *   Resolves the given entitySet parameter into
     *   an actual entityset value.
     *
     *   If Query.ROOT is passed, the current value of
     *   context.entitySet is returned.
     *
     *   If an (array) command is passed, it is executed
     *   (via valueOf) and returned.
     */
    resolveEntitySet(entitySet, compileOnly) {
        if (!entitySet) {
            entitySet = this.last;
        }

        if (entitySet === QueryOp.Root) {
            return this.entitySet;
        }

        if (Array.isArray(entitySet)) {
            if (compileOnly) {
                return entitySet;
            }
            entitySet = this.valueOf(entitySet);
        }

        if (isEntitySet(entitySet)) {
            return entitySet;
        }

        return null;
    }

    /**
     * Resolve a value of component ids
     */
    // resolveComponentIIDs(components ){
    //     const resolved = this.valueOf( components, true );
    //     return resolved ? this.registry.getIID( resolved, true ) : null;
    // }

    // Query.resolveComponentIIDs = resolveComponentIIDs;

    /**
     *
     */
    componentsToBitfield(context, components) {
        let componentIDs, result;
        // if( !context.registry ){
        //     console.log('[componentsToBitfield]', context, stringify(components));
        // }
        componentIDs = context.registry.getIID(components, {
            forceArray: true,
            // debug: true,
            throwOnNotFound: true
        });

        result = BitField.create();
        result.setValues(componentIDs, true);
        return result;
    }

    /**
     *   Takes an entityset and applies the filter to it resulting
     *   in a new entityset which is returned as a value.
     */
    commandFilter(context, entityFilter, filterFunction, options:CommandFilterOptions = {}) {
        let entities, entityContext, value;
        let entity, entitySet;
        let esCount;

        const limit = options.limit === void 0 ? 0 : options.limit;
        const offset = options.offset === void 0 ? 0 : options.offset;

        // console.log('context is', context);
        // console.log('entityfilter is', entityFilter);
        // if( true ){ console.log('commandFilter >'); console.log( _.rest(arguments) ); console.log('<'); }

        // console.log('commandFilter> ' + offset + ' ' + limit );
        // resolve the entitySet argument into an entitySet or an entity
        // the argument will either be ROOT - in which case the context entityset or entity is returned,
        // otherwise it will be some kind of entity filter
        // entitySet = Query.resolveEntitySet( context, entitySet );

        entitySet = context.valueOf(context.last || context.entitySet, true);

        if (isEntity(entitySet)) {
            entity = entitySet;
        } else {
            // console.log('commandFilter no entityset', entitySet);
        }

        if (filterFunction) {
            entityContext = new QueryContext(this.query, context);

            if (isEntity(entitySet)) {
                entityContext.entity = entity = entitySet;
                entityContext.entitySet = entitySet = null;
            }

            entityContext.entityFilter = entityFilter;

            if (entityFilter) {
                entityContext.componentIDs = entityFilter.getValues(0);
            }
        }

        if (entity) {
            value = entity;
            if (entityFilter) {
                value = entityFilter.accept(value, context);
                // console.log('yep? ' + JSON.stringify(value) );
                // console.log('so got back', value, entityFilter);
            }

            if (value && filterFunction) {
                entityContext.entity = value;
                value = executeCommand(entityContext, filterFunction);
                if (value[0] === QueryOp.Value) {
                    value = value[1] ? context.entity : null;
                }
            }
        } else {
            value = context.registry.createEntitySet({ register: false });
            esCount = 0;

            if (!filterFunction && !entityFilter && offset === 0 && limit === 0) {
                entities = entitySet.getEntities();
            } else {
                // console.log('g', entitySet );
                // select the subset of the entities which pass through the filter
                entities = entitySet.getEntities().reduce((result, entity) => {
                    let cmdResult;

                    // TODO: still not great that we are iterating over models
                    // is there a way of exiting once limit has been reached?
                    if (limit !== 0 && result.length >= limit) {
                        return result;
                    }

                    if (entityFilter) {
                        entity = entityFilter.accept(entity, context);
                    }

                    if (!entity) {
                        return result;
                    }

                    if (filterFunction) {
                        entityContext.entity = entity;
                        entityContext.debug = false;

                        cmdResult = executeCommand(entityContext, filterFunction);

                        // if( true ){ console.log('eval function ' + stringify(filterFunction) + ' ' + stringify(cmdResult), stringify(entity) ); }

                        if (context.valueOf(cmdResult) !== true) {
                            entity = null;
                        }
                    }

                    if (esCount >= offset && entity) {
                        result.push(entity);
                    }

                    esCount++;

                    return result;
                }, []);
            }

            // if( true ){ console.log('cmd filter result length ' + entities.length ); }
            value.addEntity(entities);
        }

        // console.log('well final value was ' + JSON.stringify(value) );
        // printE( value );

        return (context.last = [QueryOp.Value, value]);
    }
}



/**
 *   Query functions for the memory based entity set.
 *
 *   Some inspiration taken from https://github.com/aaronpowell/db.js
 */

function gatherEntityFilters(context, expression) {
    let ii, len, bf, result, obj;

    let filter = expression[0];
    result = new EntityFilter();

    switch (filter) {
        case EntityFilterType.Any:
        case EntityFilterType.All:
        case EntityFilterType.None:
        case EntityFilterType.Include:
            if (expression[1] === QueryOp.Root) {
                result.add(QueryOp.Root);
            } else {
                obj = context.valueOf(expression[1], true);

                if (!obj) {
                    if (filter === EntityFilterType.All) {
                        result.add(QueryOp.Root);
                        return;
                    }
                    return null;
                }
                bf = context.componentsToBitfield(context, obj);

                // filter = expression[0];
                // switch (filter) {
                //     case ALL_FILTER:
                //         filter = ALL;
                //         break;
                //     case ANY_FILTER:
                //         filter = ANY;
                //         break;
                //     case NONE_FILTER:
                //         filter = NONE;
                //         break;
                //     case INCLUDE_FILTER:
                //         filter = INCLUDE;
                //         break;
                //     default:
                //         break;
                // }
                // console.log('CONVERTED TO BF', filter, bf.toString(), bf.toJSON() );
                result.add(filter, bf);
            }
            break;
        case QueryOp.And:
            expression = expression.slice(1); // _.rest(expression);

            for (ii = 0, len = expression.length; ii < len; ii++) {
                obj = gatherEntityFilters(context, expression[ii]);
                if (!obj) {
                    return null;
                }
                result.filters = result.filters.concat(obj.filters);
            }
            break;
        default:
            return null;
    }

    return result;
}

/**
 *
 */
function commandAnd(context, ...ops) {
    let ii, len, value;

    for (ii = 0, len = ops.length; ii < len; ii++) {
        value = context.valueOf(ops[ii], true);
        if (!value) {
            break;
        }
    }

    return (context.last = [QueryOp.Value, value]);
}

function commandOr(context, ...ops) {
    let ii, len, value;

    for (ii = 0, len = ops.length; ii < len; ii++) {
        value = context.valueOf(ops[ii], true);
        if (value) {
            break;
        }
    }

    return (context.last = [QueryOp.Value, value]);
}

function commandFunction(op) {
    let result;

    result = commandFunctions[op];

    if (result !== undefined) {
        return result;
    }

    switch (op) {
        case QueryOp.And:
            result = commandAnd;
            break;
        case QueryOp.Or:
            result = commandOr;
            break;
        default:
            break;
    }
    return result;
}

function executeCommand(context, op:any|QueryOp|EntityFilterType, args?, ...rest) {
    let result, cmdFunction, cmdArgs, value;

    if (context.debug) {
        console.log('[executeCommand]', stringify(op));
    }

    if (!args) {
        // assume the op and args are in the same array
        args = op.slice(1); // _.rest(op);
        op = op[0];
    }
    const allArgs = [op, args, ...rest];

    // prepend the context to the beginning of the arguments
    cmdArgs = [context].concat(args);

    // cmdArgs.push(op);
    // console.log('executeCommand args', op, args);

    context.op = op;

    switch (op) {
        case QueryOp.Root:
            // console.log('query root', cmdArgs);
            result = context.last = [QueryOp.Value, context.root];
            break;
        case QueryOp.Value:
            value = args[0];
            if (value === QueryOp.Root) {
                value = context.root;
            }
            result = context.last = [QueryOp.Value, value];
            // if(true){ console.log('value> ' + stringify(context.last)) }
            break;
        case QueryOp.EntityFilter:
        // case QueryOp.Filter FILTER_FUNC:
        case EntityFilterType.All:
        case EntityFilterType.Include:
        case EntityFilterType.Any:
        case EntityFilterType.None:
            result = context.commandFilter(...cmdArgs);
            break;
        default:
            cmdFunction = commandFunction(op);
            if (!cmdFunction) {
                // console.log('unknown cmd ' + op);
                // printIns( _.rest(arguments), 1 );
                throw new Error('unknown cmd (' + stringify(op) + ') ' + stringify(allArgs));
            }
            // console.log('running CmdFunction for op', op);
            result = cmdFunction.apply(context, cmdArgs);
            break;
    }
    return result;
}

export function compile(context, commands, options) {
    let ii, len, entityFilter;

    let compiled = [];

    if (Query.isQuery(commands)) {
        if (commands.isCompiled) {
            return commands;
        }
        commands = commands.src || commands.toArray(true);
    } else if (Array.isArray(commands)) {
        if (!Array.isArray(commands[0]) && !Query.isQuery(commands[0])) {
            commands = [commands];
        } else {
            commands = commands.map(command => {
                if (Query.isQuery(command)) {
                    if (!command.isCompiled) {
                        command = command.toArray(true)[0];
                    }
                }
                return command;
            });
        }
    }

    let firstStageCompiled = commands.reduce((result, command) => {
        let op, entityFilter, compileResult;
        op = command[0];

        // check for registered command compile function
        if ((compileResult = compileCommands[op]) !== undefined) {
            if ((compileResult = compileResult(context, command))) {
                result.push(compileResult);
            }
            return result;
        }

        switch (op) {
            case EntityFilterType.None:
            case EntityFilterType.All:
            case EntityFilterType.Any:
            case EntityFilterType.Include:
                entityFilter = gatherEntityFilters(context, command);
                // insert a basic entity_filter command here
                result.push([QueryOp.EntityFilter, entityFilter, command[2]]);
                break;
            case QueryOp.And:
                result.push(context.resolveEntitySet(command, true) || command);
                break;
            default:
                result.push(command);
                break;
        }

        return result;
    }, []);

    entityFilter = null;

    // combine contiguous entity filters
    for (ii = 0, len = firstStageCompiled.length; ii < len; ii++) {
        // console.log('>combine', firstStageCompiled[ii] );
        while (ii < len && firstStageCompiled[ii][0] === QueryOp.EntityFilter && !firstStageCompiled[ii][2]) {
            if (!entityFilter) {
                entityFilter = EntityFilter.create(firstStageCompiled[ii][1]);
            } else {
                entityFilter.add(firstStageCompiled[ii][1]);
            }
            ii += 1;
        }
        if (entityFilter) {
            // console.log('>combine adding', entityFilter );
            compiled.push([QueryOp.EntityFilter, entityFilter]);
            entityFilter = null;
        }
        if (ii < len) {
            compiled.push(firstStageCompiled[ii]);
        }
    }
    // allow hooks to further process commands

    // console.log('compiled', this.compiled);
    // this.commands = commands;
    // if( context.debug ) { console.log(this); }
    return compiled;
}

