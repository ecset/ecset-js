import BetterSqlite3, { SqliteError } from 'better-sqlite3';
import { createLog } from '../util/log';
import { EntitySetSQL, ComponentDefSQL } from '.';
import {
    ComponentDef,
    Type as ComponentDefT,
    create as createComponentDef,
    toObject as defToObject,
    hash as defHash,
    hashStr as defHashStr,
    getDefId,
    getProperty as getDefProperty,
    ComponentDefProperty,
    getProperty,
    ComponentDefId,
} from '../component_def';
import { Entity, getEntityId, EntityId, isEntity } from '../entity';
import {
    BitField,
    create as createBitField,
    get as bfGet,
    set as bfSet,
    count as bfCount,
    and as bfAnd,
    or as bfOr,
    toValues as bfToValues,
    TYPE_AND,
    TYPE_OR,
    TYPE_NOT,
} from '@odgn/utils/bitfield';
import { Component, ComponentId, getComponentDefId, getComponentEntityId, toComponentId } from '../component';
import { StackError, SType } from '../query/types';
import { isBoolean, isRegex, isDate, isValidDate, toInteger, toNumber } from '@odgn/utils';
import { compareDates } from '../query/words/util';
import { hashToString } from '@odgn/utils';
import { stringify } from '@odgn/utils';

const Log = createLog('Sqlite');

const SCHEMA_VERSION = 1;

export interface SqlRef {
    db: BetterSqlite3.Database;
    isMemory: boolean;
    begin?: any;
    commit?: any;
    rollback?: any;
}

export interface OpenOptions {
    isMemory?: boolean;
    clearDb?: boolean;
    verbose?: any;
}

export interface OpOptions {
    debug?: boolean;
}

export interface RetrieveOptions {
    debug?: boolean;
    offset?: number;
    limit?: number;
    type?: number;
    orderDir?: 'asc' | 'desc';
    orderAttr?: string;
    orderDef?: ComponentDefSQL;
    returnSQL?: boolean;
    returnEid?: boolean;
    isCount?: boolean;
}

export interface RetrieveComponentOptions extends RetrieveOptions {
    allDefs?: boolean;
    optDefs?: boolean;
    returnCid?: boolean;
    isCount?: boolean;
}

const STMT_ENTITY_SET_SELECT_BY_UUID = 'SELECT * FROM tbl_entity_set WHERE uuid = ?';
const STMT_ENTITY_SET_INSERT = 'INSERT INTO tbl_entity_set (uuid,status) VALUES (?,?)';

enum Status {
    Inactive = 0,
    Active = 1,
}

export function sqlClear(name: string): Promise<boolean> {
    const db = new BetterSqlite3(name, { verbose: undefined });

    // Log.debug('[sqlClear]', db);

    const stmt = db.prepare(`SELECT * FROM sqlite_master WHERE type='table';`);
    const rows = stmt.all();

    for (const row of rows) {
        if (row.name === 'sqlite_sequence') {
            continue;
        }
        db.exec(`drop table ${row.name}`);
    }

    return Promise.resolve(true);
}

export function sqlOpen(path: string, options: OpenOptions): SqlRef {
    const isMemory = options.isMemory ?? true;
    const { verbose } = options;
    const db = new BetterSqlite3(isMemory ? ':memory:' : path, { verbose });

    // define our regexp function - so nice!
    db.function('regexp', { deterministic: true }, (regex, val) => {
        if (val == null) {
            return 0;
        }
        const end = regex.lastIndexOf('/');
        const flags = regex.substring(end + 1);
        const re = new RegExp(regex.substring(1, end), flags);

        // console.log('[sqlOpen][regexp]', regex, val, re.test(val) ? 1 : 0 );
        // const re = new RegExp(regex);
        return re.test(val) ? 1 : 0;
    });

    db.pragma('journal_mode = WAL');

    const begin = db.prepare('BEGIN');
    const commit = db.prepare('COMMIT');
    const rollback = db.prepare('ROLLBACK');

    const ref: SqlRef = {
        db,
        isMemory,
        begin,
        commit,
        rollback,
    };

    // Log.debug('[sqlOpen]', ref );

    const stmt = db.prepare('PRAGMA compile_options');
    const rows = stmt.all();
    // Log.debug('[sqlOpen]', rows.map(r => r.compile_options));

    initialiseSchema(ref, options);

    // ref = sqlClose(ref);

    return ref;
}

export function sqlClose(ref: SqlRef): SqlRef {
    const { db } = ref;
    if (db === undefined || db.open !== true) {
        return ref;
    }
    db.close();
    return { ...ref, db: undefined };
}

export function sqlIsOpen(ref: SqlRef): boolean {
    return ref !== undefined && ref.db !== undefined && ref.db.open;
}

export function sqlCount(ref: SqlRef): number {
    const { db } = ref;
    const stmt = db.prepare('SELECT COUNT(id) as count FROM tbl_entity');
    const row = stmt.get();
    return row === undefined ? 0 : row.count;
}

// Higher order function - returns a function that always runs in a transaction
function asTransaction(ref: SqlRef, func) {
    const { db, begin, commit, rollback } = ref;
    return function (...args) {
        begin.run();
        try {
            func(...args);
            commit.run();
        } finally {
            if (db.inTransaction) rollback.run();
        }
    };
}

/**
 * Creates a new entityset record if it doesn't exist, and returns
 * details about it
 *
 * @param {*} entitySet
 * @param {*} options
 */
export function registerEntitySet(ref: SqlRef, es: EntitySetSQL, options = {}) {
    const { db } = ref;
    Log.debug('[registerEntitySet]', es.uuid);
    // let db = openDB(options);

    // try and retrieve details of the entityset by its uuid
    let stmt = db.prepare(STMT_ENTITY_SET_SELECT_BY_UUID);
    const row = stmt.get(es.uuid);

    if (row === undefined) {
        // insert
        stmt = db.prepare(STMT_ENTITY_SET_INSERT);
        stmt.run(es.uuid, es, Status.Active);
    } else {
        Log.debug('[registerEntitySet]', 'found existing', row);
        // entitySet.id = row.entity_set_id;
    }

    return true;
}

export function sqlInsertDef(ref: SqlRef, def: ComponentDef): ComponentDefSQL {
    const { db } = ref;
    const hash = def.hash; // defHash(def);
    const schema = defToObject(def, false);
    const [tblName, sql] = defToStmt(def);

    const stmt = db.prepare('INSERT INTO tbl_component_def (url,hash,tbl,schema) VALUES (?,?,?,?)');

    const { lastInsertRowid: did } = stmt.run(def.url, hash, tblName, JSON.stringify(schema));
    // let did = sqlLastId(ref);

    // Log.debug('[sqlInsertDef]', sql);
    db.exec(sql);
    // let out = stmt.all(sql);

    const sdef = createComponentDef(did, schema) as ComponentDefSQL;
    sdef.tblName = tblName;

    return sdef as ComponentDef;
}

export function sqlUpdateEntity(ref: SqlRef, e: Entity): Entity {
    const { db } = ref;
    let eid = getEntityId(e);
    let update = true;

    if (eid === 0) {
        eid = getLastEntityId(ref);
        eid = eid === undefined ? 1 : eid + 1;
        update = false;
    }

    const bf = e.bitField !== undefined ? bfToValues(e.bitField) : [];

    // Log.debug('[sqlUpdateEntity]', eid, update );

    // asTransaction( ref, () => {
    if (!update) {
        const stmt = db.prepare('INSERT INTO tbl_entity DEFAULT VALUES;');
        const { lastInsertRowid } = stmt.run();
        eid = lastInsertRowid as EntityId; //sqlLastId(ref);
        // Log.debug('[sqlUpdateEntity]', 'err?', eid );
    } else {
        const stmt = db.prepare('INSERT INTO tbl_entity(id) VALUES (?)');
        stmt.run(eid);
        // throw 'stop';
    }

    if (bf.length > 0) {
        // Log.debug('[sqlUpdateEntity]',`inserting into tbl_entity_component ${eid}`);
        // let stmt = db.prepare('INSERT INTO tbl_entity_component(eid,did,created_at,updated_at) VALUES (?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)');
        // bf.forEach( did => {
        //     stmt.run(eid, did);
        // })
    }
    // });
    e.id = eid;

    return e;
}

export function sqlRetrieveEntity(ref: SqlRef, eid: number): Entity {
    const { db } = ref;

    // let stmt = db.prepare('SELECT did FROM tbl_entity_component WHERE eid = ?');
    let stmt = db.prepare('SELECT id FROM tbl_entity WHERE id = ?');

    let rows = stmt.all(eid);

    if (rows.length === 0) {
        return undefined;
    }

    // Log.debug('[sqlRetrieveEntity]', rows );
    stmt = db.prepare('SELECT did FROM tbl_entity_component WHERE eid = ?');
    rows = stmt.all(eid);

    const dids = rows.map((r) => r.did);
    const bf = createBitField(dids);

    return new Entity(eid, bf);
}

export function sqlUpdateComponent(
    ref: SqlRef,
    com: Component,
    def: ComponentDefSQL,
    options: OpOptions = {},
): Component {
    const { db } = ref;
    // const debug = options.debug ?? false;
    const { '@e': eid, '@d': did } = com;
    const { tblName } = def;

    // add to tbl_component
    let stmt = db.prepare(`SELECT id FROM ${tblName} WHERE eid = ? LIMIT 1`);
    const row = stmt.get(eid);
    const exists = row !== undefined;

    const names = def.properties.map((p) => (p.persist === true ? `${p.name}` : undefined)).filter(Boolean);

    // if( getComponentDefId(com) === 14 ) Log.debug('[sqlUpdateComponent]', com);
    if (exists) {
        const { id } = row;
        const set = defToSetStmt(def);
        // let vals = names.map(name => com[name]);
        const vals = names.map((name) => valueToSQL(com[name], getDefProperty(def, name)));
        const sql = `UPDATE ${tblName} ${set} WHERE id = ?`;
        stmt = db.prepare(sql);
        stmt.run([...vals, id]);
        // if( debug ) Log.debug('[sqlUpdateComponent][update]', eid, did, sql, names, 'vals', vals );
    } else {
        const cols = ['eid'];
        // cols = def.properties.reduce( (cols,p) => [...cols,p.name], cols );
        const colString = [...cols, ...names].map((c) => `'${c}'`).join(',');
        let vals: any[] = [eid];
        vals = [...vals, ...names.map((name) => valueToSQL(com[name], getDefProperty(def, name)))];
        const valString = vals.map((v) => '?').join(',');
        // if( getComponentDefId(com) === 14 )  Log.debug('[sqlUpdateComponent]',`INSERT INTO ${tblName} (${colString}) VALUES (${valString});`, vals, com);
        // if( getComponentDefId(com) === 14 )  Log.debug('[sqlUpdateComponent]', 'def', def);
        const sql = `INSERT INTO ${tblName} (${colString}) VALUES (${valString});`;
        stmt = db.prepare(sql);
        const { lastInsertRowid: cid } = stmt.run(vals);
        // const cid = sqlLastId(ref);

        // if( lastInsertRowid !== cid ){
        //     throw new Error('oh no!');
        // }
        // Log.debug('[sqlUpdateComponent][insert]', eid, changes);

        // Log.debug('[sqlUpdateComponent][insert]', eid, did, sql, {colString, vals});
        // if( debug ) Log.debug('[sqlUpdateComponent][insert]', eid, did, sql, names, 'vals', vals );
        // if( debug ) Log.debug('[sqlUpdateComponent][insert]', 'result cid', {cid} );

        // Log.debug('[sqlUpdateComponent]',`inserting into tbl_entity_component ${eid} ${did} ${cid}`);
        stmt = db.prepare(
            'INSERT INTO tbl_entity_component (eid,did,cid,created_at,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
        );
        const r = stmt.run(eid, did, cid);

        // if( debug ) Log.debug('[sqlUpdateComponent][insert]', 'tbl_e_c result cid', r );
    }

    return com;
}

export function sqlBegin(ref: SqlRef) {
    const { db, begin } = ref;
    // Log.debug('[sqlBegin]');
    begin.run();
    // db.exec('BEGIN TRANSACTION;');
}
export function sqlCommit(ref: SqlRef) {
    const { db, commit } = ref;
    commit.run();
    // db.exec('COMMIT;');
    // Log.debug('[sqlCommit]');
}

/**
 *
 * @param ref
 * @param eid
 * @param def
 */
export function sqlDeleteComponent(ref: SqlRef, eid: EntityId, def: ComponentDefSQL): Entity {
    const { db } = ref;
    const { tblName } = def;

    let stmt = db.prepare(`DELETE FROM ${tblName} WHERE eid = ?`);
    stmt.run(eid);

    stmt = db.prepare('DELETE FROM tbl_entity_component WHERE eid = ? AND did = ?');
    stmt.run(eid, getDefId(def));

    return sqlRetrieveEntity(ref, eid);
}

export function sqlDeleteEntity(ref: SqlRef, eid: EntityId) {
    const { db } = ref;

    let stmt = db.prepare(`DELETE FROM tbl_entity WHERE id = ?`);
    stmt.run(eid);

    stmt = db.prepare(`DELETE FROM tbl_entity_component WHERE eid = ?`);
    stmt.run(eid);

    return true;
}

function defToSetStmt(def: ComponentDefSQL) {
    const parts = def.properties.map((prop) => {
        return `'${prop.name}' = ?`;
    });
    return parts.length > 0 ? `SET ${parts.join(',')}` : '';
}

export function sqlComponentExists(ref: SqlRef, eid: number, did: number): boolean {
    const { db } = ref;
    const stmt = db.prepare('SELECT cid FROM tbl_entity_component WHERE eid = ? AND did = ? LIMIT 1');
    const row = stmt.get(eid, did);
    return row !== undefined;
}

export function sqlRetrieveComponent(ref: SqlRef, eid: EntityId, def: ComponentDefSQL): Component {
    const { db } = ref;
    const { tblName } = def;
    // const did = def[ComponentDefT];
    if (isEntity(eid)) {
        throw new StackError('e not allowed');
    }

    const sql = `SELECT * FROM ${tblName} WHERE eid = ? LIMIT 1`;

    // Log.debug('[sqlRetrieveComponent]', sql, eid );
    const row = db.prepare(sql).get(eid);

    if (row === undefined) {
        return undefined;
    }

    // Log.debug('[sqlRetrieveComponent]', row );

    const com = rowToComponent(def, row);
    // let { created_at: ca, updated_at: ua, id: id, eid: ee } = row;

    // let com = { '@e': eid, '@d': did };

    // for( const prop of def.properties ){
    //     let val = row[ prop.name ];
    //     switch( prop.type ){
    //         case 'json':
    //         case 'boolean':
    //             val = JSON.parse(val);
    //             break;
    //     }

    //     com[prop.name] = val;
    // }

    return com;
}

function rowToComponent(def: ComponentDefSQL, row: any): Component {
    const did = def[ComponentDefT];
    const com: any = { '@e': row.eid, '@d': did };

    for (const prop of def.properties) {
        let val = row[prop.name];
        switch (prop.type) {
            case 'json':
            case 'boolean':
                val = JSON.parse(val);
                break;
        }

        if (val === null) {
            continue;
        }

        com[prop.name] = val;
    }

    return com;
}

/**
 * Returns a generator which yields each component of a given def type
 *
 * @param ref
 * @param def
 */
export function* sqlRetrieveComponentsByDef(ref: SqlRef, def: ComponentDefSQL) {
    const { db } = ref;

    const stmt = db.prepare(`SELECT * FROM ${def.tblName} ORDER BY eid`);

    for (const row of stmt.iterate()) {
        yield rowToComponent(def, row);
    }
}

/**
 * Retrieves components of entities which have the specified defs
 *
 * @param ref
 * @param eids
 * @param defs
 */
export function sqlRetrieveComponents(
    ref: SqlRef,
    eids: EntityId[],
    defs: ComponentDefSQL[],
    options: RetrieveComponentOptions = {},
): Component[] | ComponentId[] {
    const { db } = ref;
    const result = [];
    const allDefs = options.allDefs ?? false;
    const optDefs = options.optDefs ?? false;
    const returnCid = options.returnCid ?? false;
    const { isCount, offset, limit, orderDir, orderAttr, orderDef } = options;

    if (eids !== undefined && eids.length === 0) {
        return result;
    }

    const dids = defs.map((d) => getDefId(d));

    const eidCondition = eids === undefined ? '' : `AND eid IN (${eids})`;

    // NOTE - this is horrible
    const havingCondition = allDefs || optDefs ? '' : `HAVING COUNT(eid) = ${dids.length}`;

    // if( isCount ){
    //     select = 'SELECT COUNT(DISTINCT(ec.eid)) AS count';
    // }

    // let sql = `
    // SELECT DISTINCT eid,did FROM tbl_entity_component
    // WHERE eid IN (
    //     SELECT eid FROM tbl_entity_component
    //     WHERE did IN (${dids}) ${eidCondition}
    //     GROUP BY eid ${havingCondition}
    // )
    // AND did IN (${dids})
    // `;

    // if( isCount ){
    //     let sql = `SELECT COUNT(did) AS count FROM tbl_entity_component WHERE did IN (${dids})`;
    //     return db.prepare(sql).get().count
    // }

    let select = `eid,did`;
    if (isCount) {
        select = `COUNT(eid) AS count`;
    }

    // SELECT COUNT(did) AS count FROM tbl_entity_component WHERE did IN (1,2) AND eid IN (

    let sql = `SELECT ${select} FROM tbl_entity_component WHERE did IN (${dids}) ${eidCondition}`;

    if (!(allDefs || optDefs)) {
        const buffer = [];
        for (let ii = 0; ii < dids.length; ii++) {
            buffer.push(`SELECT eid FROM tbl_entity_component WHERE did = ${dids[ii]} ${eidCondition}`);
        }
        sql = buffer.join(' INTERSECT ');

        if (isCount) {
            sql = `SELECT COUNT(did) AS count FROM tbl_entity_component WHERE did IN (${dids}) AND eid IN ( ${sql} )`;
        }
    }

    // Log.debug('[sqlRetrieveComponents]', {dids});
    // Log.debug('[sqlRetrieveComponents]', 'defs', defs );
    // Log.debug('[sqlRetrieveComponents]', {isCount}, sql);

    const stmt = db.prepare(sql);

    if (isCount) {
        return stmt.get().count;
    }

    // get rid of duplicates - although shouldnt the sql do this?
    eids = Array.from(new Set(stmt.all().map((r) => r.eid)));

    // Log.debug('[sqlRetrieveComponents]', 'result', {allDefs,optDefs}, eids );
    // Log.debug('[sqlRetrieveComponents]', 'defs', defs );
    // Log.debug('[sqlRetrieveComponents]', 'orderDef', orderDef );

    // build a list of entity ids which have all the defs

    for (let ii = 0; ii < defs.length; ii++) {
        const def = defs[ii];
        const did = getDefId(def);

        let rows;
        if (eids === undefined) {
            const sql =
                orderDef === undefined
                    ? `SELECT * FROM ${def.tblName} ORDER BY eid`
                    : `SELECT a.*,b.${orderAttr} FROM ${def.tblName} AS a
                LEFT JOIN ${orderDef.tblName} AS b ON b.eid = a.eid
                ORDER BY b.${orderAttr} ${orderDir} LIMIT ${offset},${limit}
                `;
            rows = db.prepare(sql).all();
        } else {
            const params = buildInParamString(eids);
            const sql =
                orderDef === undefined
                    ? `SELECT * FROM ${def.tblName} WHERE eid IN (${params}) ORDER BY eid`
                    : `SELECT a.*,b.${orderAttr} FROM ${def.tblName} AS a
                LEFT JOIN ${orderDef.tblName} AS b ON b.eid = a.eid
                WHERE a.eid IN (${params})
                ORDER BY b.${orderAttr} ${orderDir} LIMIT ${offset},${limit}
                `;
            // Log.debug('[sqlRetrieveComponents]', sql, eids );
            rows = db.prepare(sql).all(...eids);
        }

        for (let rr = 0; rr < rows.length; rr++) {
            const row = rows[rr];
            const com = rowToComponent(def, row);
            // result.push(com);
            // Log.debug('[sqlRetrieveComponents]', 'push', toComponentId(getComponentEntityId(com), did));
            result.push(returnCid ? toComponentId(getComponentEntityId(com), did) : com);
        }
    }

    return result;
}

function buildInParamString(params: any[]): string {
    return '?,'.repeat(params.length).slice(0, -1);
}
export function sqlRetrieveEntityComponents(ref: SqlRef, eid: number, defs: ComponentDefSQL[]): Component[] {
    return defs.map((def) => sqlRetrieveComponent(ref, eid, def));
}

export function sqlLastId(ref: SqlRef): number {
    const stmt = ref.db.prepare('SELECT last_insert_rowid() AS id');
    const { id } = stmt.get();
    return id;
}

export function sqlGetEntities(ref: SqlRef): number[] {
    const stmt = ref.db.prepare('SELECT id FROM tbl_entity');
    const rows = stmt.all();
    if (rows.length === 0) {
        return [];
    }

    return rows.map((r) => r.id);
}

export function getLastEntityId(ref: SqlRef): number {
    const stmt = ref.db.prepare('SELECT id FROM tbl_entity ORDER BY id DESC LIMIT 1');
    const row = stmt.get();
    return row !== undefined ? row.id : 0;
}

export function sqlRetrieveDefs(ref: SqlRef): ComponentDefSQL[] {
    const { db } = ref;
    const stmt = db.prepare('SELECT * FROM tbl_component_def');
    const rows = stmt.all();

    return rows.map((row) => {
        const { id, schema } = row;
        // Log.debug('[sqlRetrieveDefs]', id );
        // return createComponentDef(id, JSON.parse(schema));
        return sqlCreateComponentDef(id, schema);
    });
}

export function sqlRetrieveDefByUrl(ref: SqlRef, url: string): ComponentDef {
    const { db } = ref;

    const stmt = db.prepare('SELECT * FROM tbl_component_def WHERE url = ? LIMIT 1');
    const row = stmt.get(url);

    if (row === undefined) {
        return undefined;
    }

    const { id, schema } = row;
    return sqlCreateComponentDef(id, schema);
}

export function sqlRetrieveDefByHash(ref: SqlRef, id: number): ComponentDefSQL {
    const { db } = ref;

    const stmt = db.prepare('SELECT * FROM tbl_component_def WHERE hash = ? LIMIT 1');
    const row = stmt.get(id);

    if (row === undefined) {
        return undefined;
    }

    const { id: did, schema } = row;
    return sqlCreateComponentDef(did, schema);
}

function sqlCreateComponentDef(did: ComponentDefId, schema: string): ComponentDefSQL {
    const def = createComponentDef(did, JSON.parse(schema)) as ComponentDefSQL;
    def.tblName = defToTbl(def);
    return def;
}

/**
 *
 * @param ref
 * @param eids
 * @param options
 */
export function sqlRetrieveEntityIds(ref: SqlRef, eids?: EntityId[], options: RetrieveOptions = {}): EntityId[] {
    return [];
}

/**
 * Retrieves entities with the given entityIds
 *
 * @param ref
 * @param eids
 */
export function sqlRetrieveEntities(
    ref: SqlRef,
    eids?: EntityId[],
    options: RetrieveOptions = {},
): Entity[] | EntityId[] | string {
    const { db } = ref;
    let { offset, limit, orderDef, orderAttr, orderDir } = options;
    const returnSQL = options.returnSQL ?? false;
    const returnEid = options.returnEid ?? false;
    const isCount = options.isCount ?? false;
    let rows;
    let sql: string;

    orderDir = orderDir ?? 'asc';

    // console.log( options );

    if (eids !== undefined) {
        sql = `SELECT eid,did FROM tbl_entity_component 
            WHERE eid IN (${eids}) 
            ORDER BY eid LIMIT ${offset}, ${limit}`;

        if (returnSQL) {
            return `SELECT DISTINCT eid FROM tbl_entity_component WHERE eid IN (${eids}) ORDER BY eid ${orderDir} LIMIT ${offset}, ${limit}`;
        }
    } else {
        let select = returnSQL ? 'SELECT DISTINCT ec.eid' : 'SELECT ec.eid, ec.did';

        if (isCount) {
            select = 'SELECT COUNT(DISTINCT(ec.eid)) AS count';
        }

        let orderLimit = isCount ? '' : `LIMIT ${offset}, ${limit}`;

        if (!isCount && orderAttr !== undefined) {
            orderLimit = `ORDER BY ${orderAttr} ${orderDir} ` + orderLimit;
        }
        // let orderLimit = isCount ? '' : `ORDER BY ${orderAttr} ${orderDir} LIMIT ${offset}, ${limit}`;

        sql = `${select} FROM tbl_entity_component AS ec ${orderLimit}`;
        if (orderDef !== undefined) {
            sql = `
            ${select} FROM tbl_entity_component AS ec
            JOIN
            (SELECT eid,${orderAttr} FROM ${orderDef.tblName}
            ${orderLimit}
            ) AS s
            ON ec.eid = s.eid`;
        }

        if (returnSQL) {
            return sql;
        }
    }

    // Log.debug('[sqlRetrieveEntities]', {isCount, orderAttr, offset, limit}, sql);

    if (isCount) {
        return db.prepare(sql).get().count;
    }

    rows = db.prepare(sql).all();

    // Log.debug('[sqlRetrieveEntities]', returnEid, rows);
    if (returnEid) {
        // todo - sql should be altered to return eids, rather than entities
        const result = Array.from(new Set(rows.map((r) => r.eid)));
        // Log.debug('[sqlRetrieveEntities]', returnEid, result);
        return result as EntityId[];
    }

    const result = rows.reduce((result, { eid, did }) => {
        let e = result[eid];
        if (e === undefined) {
            e = new Entity(eid);
        }
        e.bitField = bfSet(e.bitField, did);
        return { ...result, [eid]: e };
    }, {});
    return Object.values(result) as Entity[];
}

/**
 * Retrieves entities which have ALL of the specified Def Ids
 *
 * @param ref
 * @param did
 */
export function sqlRetrieveEntitiesByDefId(
    ref: SqlRef,
    did: ComponentDefId[],
    eids?: EntityId[],
    options: RetrieveOptions = {},
): Entity[] | string {
    const { db } = ref;
    const type = options.type ?? TYPE_AND;
    const { limit, offset, orderDef, orderAttr, orderDir } = options;

    if (did === undefined || did.length === 0) {
        return type === TYPE_AND || type === TYPE_OR ? [] : (sqlRetrieveEntities(ref) as Entity[]);
    }

    const qualifier = type === TYPE_NOT ? 'NOT' : '';
    let sql: string;
    let innerSql: string;

    if (orderDef !== undefined) {
        // Log.debug('[sqlRetrieveEntityByDefId]', orderDef);

        const eidSql = eids !== undefined ? `AND s.eid in (${eids}) ` : '';

        // SELECT s.eid, t.${orderAttr}, COUNT(DISTINCT s.did) AS cnt FROM tbl_entity_component AS s
        innerSql = `
        SELECT s.eid, t.${orderAttr} FROM tbl_entity_component AS s
        LEFT JOIN ${orderDef.tblName} AS t ON t.eid = s.eid
        WHERE s.did IN (${did}) ${eidSql}
        GROUP BY s.eid
        HAVING COUNT(DISTINCT s.did) = ${did.length}
        ORDER BY t.${orderAttr} ${orderDir}
        LIMIT ${offset}, ${limit}
        `;

        sql = `
        SELECT s.eid, s.did FROM tbl_entity_component AS s INNER JOIN(
            SELECT a.eid FROM tbl_entity_component AS a 
                    INNER JOIN(
                        ${innerSql}
            ) AS b ON a.eid = b.eid WHERE a.did IN (${did})
            ) AS t ON s.eid = t.eid
        `;
    } else {
        // SELECT eid, COUNT(DISTINCT did) AS cnt
        innerSql = `
            SELECT eid
            FROM tbl_entity_component
            WHERE did IN (${did})
            GROUP BY eid
            HAVING COUNT(DISTINCT did) = ${did.length}
            ORDER BY eid ${orderDir}
            LIMIT ${offset},${limit}
        `;
        const eidSql = eids !== undefined ? `eid in (${eids}) AND` : '';
        sql = `
    SELECT eid,did FROM tbl_entity_component
    WHERE ${eidSql}
    eid ${qualifier} IN (

        SELECT a.eid FROM tbl_entity_component AS a 
        INNER JOIN(
            ${innerSql}
        ) AS b ON a.eid = b.eid WHERE a.did IN (${did})
    )`;
    }

    if (options.returnSQL) {
        // Log.debug('[sqlRetrieveEntityByDefId]', 'inner', innerSql);
        return innerSql;
    }
    // Log.debug('[sqlRetrieveEntityByDefId]', sql);
    const rows = db.prepare(sql).all();
    // Log.debug('[sqlRetrieveEntityByDefId]', rows);

    const result = rows.reduce(
        ([result, e], { eid, did }) => {
            if (e === undefined || e.id !== eid) {
                e = new Entity(eid);
                result.push(e);
            }
            e.bitField = bfSet(e.bitField, did);
            return [result, e];
        },
        [[], undefined],
    );

    // let result = rows.reduce((result, { eid, did }) => {
    //     let e = result[eid] ?? new Entity(eid);
    //     e.bitField = bfSet(e.bitField, did);
    //     return { ...result, [eid]: e };
    // }, {});
    return result[0]; //Object.values(result);
}

export interface RetrieveByFilterOptions extends RetrieveOptions {
    selectEidSql?: string;
}

/**
 *
 * @param ref
 * @param eids
 * @param query
 */
export function sqlRetrieveByFilterQuery(
    ref: SqlRef,
    eids: EntityId[],
    query: any[],
    options: RetrieveByFilterOptions = {},
) {
    const { db } = ref;
    const { debug } = options;

    // let comp;
    const sqlParts = [];
    let params = [];
    // Log.debug('[sqlRetrieveByQuery]', query);
    walkFilterQuery(eids, sqlParts, params, ...query);

    // sql.push('ORDER BY eid')
    // Log.debug('[sqlRetrieveByQuery]', sqlParts, params);
    // Log.debug('[sqlRetrieveByQuery]', sql, params.map(p => Array.isArray(p) ? stringify(p) : p) );

    let sql: string;
    if (options.selectEidSql) {
        sql = `
        SELECT s.id AS eid FROM tbl_entity AS s INNER JOIN ( 
            ${options.selectEidSql}
        ) AS t ON s.id = t.eid WHERE t.eid IN ( 
            ${sqlParts.join('\n')}
        );`;
        // sqlParts.join('\n')
    } else {
        sql = sqlParts.join('\n');
    }
    // Log.debug('[sqlRetrieveByFilterQuery]', sql);
    const stmt = db.prepare(sql);

    params = params.map((p) => {
        if (Array.isArray(p)) {
            if (p.length === 1) {
                return p[0];
            }
            return stringify(p);
        }
        return p;
    });

    params = params.map((p) => (Array.isArray(p) ? stringify(p) : p));

    const rows = stmt.all(...params);

    // Log.debug('[sqlRetrieveByQuery]', sql, params );

    // Log.debug('[sqlRetrieveByQuery]', sql, params, rows);

    return [SType.List, rows.map((r) => [SType.Entity, r.eid])];
}

function walkFilterQuery(eids: EntityId[], out: string[], params: any[], cmd?, ...args) {
    if (cmd === 'dids') {
        const dids = args[0];
        out.push(`SELECT eid from tbl_entity_component WHERE did IN ( ? )`);
        params.push(dids);
    } else if (cmd === 'and') {
        walkFilterQuery(eids, out, params, ...args[1]);
        out.push('INTERSECT');
        walkFilterQuery(eids, out, params, ...args[0]);
    } else if (cmd === 'or') {
        out.push('SELECT eid FROM (');
        walkFilterQuery(eids, out, params, ...args[0]);
        out.push('UNION');
        walkFilterQuery(eids, out, params, ...args[1]);
        out.push(')');
    } else {
        switch (cmd) {
            case '==':
            case '!=':
            case '>':
            case '>=':
            case '<':
            case '<=':
                return walkFilterQueryCompare(eids, out, params, cmd, ...args);
            default:
                console.log('[walkFQ]', `unhandled ${cmd}`);
                // return eids;
                break;
        }
    }
}

function walkFilterQueryCompare(eids: EntityId[], out: string[], params: any[], cmd?, ...args) {
    const { def } = args[0];
    const tbl = defToTbl(def);
    const [ptr, val] = args[1];

    // get the first part of the ptr - the property name
    // the rest of the ptr is converted to a sqlite json /path/key -> $.path.key
    let [key, path] = ptrToSQL(ptr);

    const props = getProperty(def, key);

    if (props.type === 'json') {
        key = `json_extract( ${key}, '${path}' )`;
    }

    // console.log(' ', key, path );
    const op = compareOpToSQL(cmd);
    const prop = getDefProperty(def, key);

    if (isRegex(val)) {
        // console.log(`SELECT eid from ${tbl} WHERE ${key} REGEXP '${val.toString()}'`);
        out.push(`SELECT eid from ${tbl} WHERE ${key} REGEXP '${val.toString()}'`);
    } else if (Array.isArray(val)) {
        const arrOp = cmd === '!=' ? 'NOT IN' : 'IN';
        // console.log(`SELECT eid from ${tbl} WHERE ${key} ${arrOp} (${val})`, op);
        out.push(`SELECT eid from ${tbl} WHERE ${key} ${arrOp} (${val})`);
        // params.push(valueToSQL(val,prop));
    } else {
        // console.log(`SELECT eid from ${tbl} WHERE ${key} ${op} ?`, valueToSQL(val,prop), val );
        // out.push(`SELECT eid from ${tbl} WHERE eid IN (${eids}) AND ${key} ${op} ?`);
        out.push(`SELECT eid from ${tbl} WHERE ${key} ${op} ?`);
        params.push(valueToSQL(val, prop));
    }
}

function compareOpToSQL(op: string) {
    switch (op) {
        case '==':
            return '=';
        case '!=':
            return '<>';
        case '>':
        case '>=':
        case '<':
        case '<=':
        default:
            return op;
    }
}

function ptrToSQL(ptr: string) {
    if (ptr.charAt(0) === '/') {
        const parts = ptr.substring(1).split('/');
        const [prop, ...path] = parts;
        return [prop, '$.' + path.join('.')];
    }
    return [ptr, undefined];
}

function componentRowToComponent(did, row): Component {
    const { eid, ...others } = row;
    return { '@e': eid, '@d': did, ...others };
}

function defToTbl(def: ComponentDef) {
    return 'tbl' + def.url.split('/').join('_') + '_' + hashToString(def.hash);
}
function getDefColumns(def: ComponentDef) {
    const properties = def.properties || [];
    return properties.map((p) => p.name);
}

function defToStmt(def: ComponentDef) {
    const tblName = defToTbl(def);
    const hash = hashToString(def.hash);
    const properties = def.properties || [];

    let props = properties
        .map((prop) => {
            if (prop.persist === false) {
                return undefined;
            }
            return `'${prop.name}' ${propTypeToSQL(prop.type)}`;
        })
        .filter(Boolean)
        .join(',\n');
    if (props.length > 0) {
        props = props + ',';
    }

    const sql = `
    CREATE TABLE IF NOT EXISTS ${tblName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eid INTEGER,
        ${props}
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    UPDATE SQLITE_SEQUENCE SET seq = 1 WHERE name = '${tblName}';
    CREATE INDEX IF NOT EXISTS idx_${hash}_eid ON ${tblName} (eid);
    `;

    return [tblName, sql];
}

function propTypeToSQL(type: string): string {
    switch (type) {
        case 'integer':
        case 'entity':
            return 'INTEGER';
        case 'number':
            return 'REAL';
        case 'boolean':
            return 'BOOLEAN';
        default:
            return 'TEXT';
    }
}

function valueToSQL(value: any, property?: ComponentDefProperty) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (property !== undefined) {
        switch (property.type) {
            case 'integer':
            case 'entity':
                return toInteger(value);
            case 'number':
                return toNumber(value);
            case 'string':
                return value + '';
            case 'datetime':
                const dte = new Date(value);
                return isValidDate(dte) ? dte.toISOString() : undefined;
            default:
                return JSON.stringify(value);
        }
    }
    if (isRegex(value)) {
    }

    if (isBoolean(value)) {
        return value + '';
    }
    return value;
}

function initialiseSchema(ref: SqlRef, options: OpenOptions = {}) {
    let existingVersion = 0;
    const { clearDb } = options;
    const { db } = ref;

    try {
        const stmt = db.prepare('SELECT version FROM tbl_meta LIMIT 1');
        const row = stmt.get();
        existingVersion = row.version;
        // Log.debug('[initialseSchema]', 'meta information found', row );
    } catch (err) {
        // Log.warn('[initialiseSchema]', 'error', err.message);
    }

    if (clearDb || existingVersion < SCHEMA_VERSION) {
        // Log.debug(
        //     '[initialseSchema]',
        //     'no meta information found or out of date'
        // );
        db.exec(tblEntitySet);
    } else {
        // Log.debug('[initialseSchema]', 'existing db version', existingVersion);
    }
}

const tblEntitySet = `
    PRAGMA foreign_keys=OFF;
    BEGIN TRANSACTION;

    DROP TABLE IF EXISTS "tbl_meta";
    CREATE TABLE
        tbl_meta
    (
        version INTEGER
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    INSERT INTO tbl_meta (version) VALUES ( ${SCHEMA_VERSION} );

    DROP TABLE IF EXISTS "tbl_entity_set";
    CREATE TABLE
        tbl_entity_set
        (
            id INTEGER PRIMARY KEY,
            uuid STRING,
            status INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    
    DROP TABLE IF EXISTS "tbl_component_def";
    CREATE TABLE tbl_component_def (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eid INTEGER,
        url STRING,
        hash INTEGER,
        tbl STRING,
        schema STRING,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- UPDATE sqlite_sequence SET seq = 1 WHERE name = "tbl_component_def";
        
    DROP TABLE IF EXISTS "tbl_entity";
    CREATE TABLE tbl_entity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- UPDATE sqlite_sequence SET seq = 1 WHERE name = "tbl_entity";

    -- links tbl_entity to tbl_com
    DROP TABLE IF EXISTS "tbl_entity_component";
    CREATE TABLE tbl_entity_component (
        eid INTEGER, -- entity_id
        did INTEGER, -- component_def_id
        cid INTEGER, -- component_id,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_entity_component ON tbl_entity_component (eid,did);

    COMMIT;
`;
