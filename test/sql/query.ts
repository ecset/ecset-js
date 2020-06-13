import { assert } from 'chai';
import { createLog } from '../../src/util/log';
import { tokenizeString } from '../../src/query/tokenizer';

import {
    EntitySetSQL
} from '../../src/entity_set_sql';

import { QueryStack } from '../../src/query/stack';

import {
    SType,
    StackValue,
} from '../../src/query/types';

import { createStdLibStack } from '../../src/query';
import {
    toValues as bfToValues,
} from '../../src/util/bitfield';
import {
    getEntityId, Entity
} from '../../src/entity';
import { sqlClear } from '../../src/entity_set_sql/sqlite';
import { EntitySet, EntitySetOptions } from '../../src/entity_set';





const Log = createLog('TestSQLQuery');

const liveDB = { uuid: 'test.sqlite', isMemory: false, debug:false };
const testDB = { uuid: 'TEST-1', isMemory: true };

const createEntitySet = () => new EntitySetSQL(testDB);

const parse = (data) => tokenizeString(data, { returnValues: true });
const sv = (v): StackValue => [SType.Value, v];


describe('Query (SQL)', () => {

    beforeEach(async () => {
        await sqlClear('test.sqlite');
    })

    describe('Select', () => {

        it('fetches entities by id', async () => {
            let query = `[ 102 @e ] select`;
            let [stack] = await prepES(query, 'todo');

            // ilog(stack.items);
            let result = stack.popValue();

            // the return value is an entity
            assert.equal(result, 102);
        });

        it('fetches entities by did', async () => {
            let query = `[ "/component/completed" !bf @e] select`;
            let [stack] = await prepES(query, 'todo');

            // the result will be a list value of entities
            let result = stack.popValue(0, true);

            assert.deepEqual(
                result.map(e => getEntityId(e)),
                [100, 101, 102]);

            assert.deepEqual(
                result.map(e => bfToValues(e.bitField)),
                [[1, 2, 3, 4], [1, 2], [1, 2]]);
        });


        it('fetches component attributes', async () => {
            let [stack] = await prepES(`[ 
                /component/title !bf
                @c
                /text pluck
            ] select`, 'todo');

            let result = stack.popValue(0, true);
            assert.deepEqual(result, [
                'get out of bed',
                'phone up friend',
                'turn on the news',
                'drink some tea',
                'do some shopping'
            ])
        });

        it('fetches entity component attribute', async () => {
            let [stack] = await prepES(`[ 
                103 @e 
                /component/title !bf
                @c
                /text pluck
            ] select`, 'todo');

            // ilog(stack.items);
            let result = stack.popValue(0, true);
            assert.equal(result, 'drink some tea');
        })

        it('fetches matching component attribute', async () => {
            let [stack] = await prepES(`[ 
                // fetches values for text from all the entities in the es
                /component/title#/text !ca
                "do some shopping"
                // equals in this context means match, rather than equality
                // its result will be components
                ==
                /component/title !bf
                @c
            ] select
            `, 'todo');

            let coms = stack.popValue(0, true);
            assert.equal(coms[0].text, "do some shopping");
        });

        it('fetches entities matching component attribute', async () => {
            let [stack] = await prepES(`[ 
                // fetches values for text from all the entities in the es
                /component/completed#/isComplete !ca
                true
                // equals in this context means match, rather than equality
                // its result will be components
                ==
                @e
            ] select`, 'todo');

            let ents = stack.popValue(0, true);

            assert.deepEqual(ents.map(e => getEntityId(e)), [100, 101]);
        });

        it('uses multi conditions', async () => {
            let query = `[
            /component/position#/file !ca a ==
            /component/position#/rank !ca 2 ==
            and
            all
            @c
            ] select !e`

            let [stack] = await prepES(query, 'chess');

            let e: Entity = stack.popValue();

            assert.equal(e.size, 3);
            assert.equal(e.Colour.colour, 'white');
        });

        it('and/or condition', async () => {
            let query = `
            // create an es with the defs
            dup @d {} !es swap + swap
            [
                /component/position#/file !ca a ==
                /component/position#/file !ca f ==
                or
                /component/colour#/colour !ca white ==
                and
                @c
            ] select
            +
            `;

            let [stack] = await prepES(query, 'chess');

            let es = stack.popValue();

            assert.equal(await es.size(), 4);
        });

        it('super select', async () => {
            let [stack, es] = await prepES(`
            // define a variable holding the es so we don't have to
            // keep swapping things aroung
            es let

            [
                uid let
                ^es [ /component/username#/username !ca  *^uid == ] select
                0 @
            ] selectUserId define
            
            [
                ch_name let
                // adding * to a ^ stops it from being eval'd the 1st time, but not the 2nd
                ^es [ /component/channel#/name !ca *^ch_name == ] select
                0 @
            ] selectChannelId define
            
            ggrice selectUserId 
            
            "mr-rap" selectChannelId
            
            
            // compose a new component which belongs to the 'mr-rap' channel
            [ "/component/channel_member" { "@e":14, channel: ^^$0, client: ^^$0 } ]

            to_str
            `, 'irc');

            assert.equal(stack.popValue(),
                '["/component/channel_member", {"@e": 14,"channel": 3,"client": 11}]');
        })

        it('multi fn query', async () => {
            let [stack, es] = await prepES(`
            es let
            [
                client_id let
                ^es [
                    /component/channel_member#/client !ca *^client_id ==
                    /component/channel_member !bf
                    @c
                ] select

                // pick the channel attributes
                /channel pluck 
            ] selectChannelsFromMember define

            [
                channel_ids let
                ^es [
                    /component/channel_member#/channel !ca *^channel_ids ==
                    /component/channel_member !bf
                    @c
                ] select

                // select client attr, and make sure there are no duplicates
                /client pluck unique 
                
                // make sure this list of clients doesnt include the client_id
                [ ^client_id != ] filter

            ] selectChannelMemberComs define

            [
                eids let
                ^es [ *^eids [/component/nickname] !bf @c ] select
            ] selectNicknames define

            [
                // 1. select channel ids which 'client_id' belongs to
                selectChannelsFromMember

                // 2. select channel members which belong to channel_ids
                selectChannelMemberComs
             
                // 3. using the channel_member client ids select the entities
                selectNicknames

            ] selectChannelMembersByClientId define

            // selects the nicknames of other entities who share
            // the same channel as 9 (roxanne)
            9 selectChannelMembersByClientId

            `, 'irc');

            let result = stack.popValue();
            let nicknames = result.map(v => v.nickname);
            assert.includeMembers(nicknames, ['koolgrap', 'lauryn', 'missy']);
        });


        describe('Component Attribute', () => {

            it('selects a JSON attribute', async () => {
                let [stack] = await prepES(`
                [
                    // where( attr('/component/meta#/meta/author').equals('av') )
                    /component/meta#/meta/author !ca av ==
                    /component/meta !bf
                    @c
                    /meta/tags/1 pluck
                ] select
                `, 'todo');

                // ilog( stack.items );
                assert.equal(stack.popValue(), 'action');

            });

            // setting a ca? 
            // /com/example#/meta/isEnabled true !ca
            // getting a ca?
            // /com/example#/meta/isEnabled !ca
        })

    });


});

async function prep(insts?: string): Promise<[QueryStack, EntitySet]> {
    let es = createEntitySet();

    let stack = createStdLibStack();

    if (insts) {
        const words = parse(insts);
        // Log.debug('[parse]', words );
        await stack.pushValues(words);
    }

    // let stack = await es.query(insts, {values} );
    return [stack, es];
}

async function prepES(insts?: string, fixture?: string, options: EntitySetOptions = {}): Promise<[QueryStack, EntitySet]> {
    let es = createEntitySet();
    let values: StackValue[];

    if (fixture) {
        values = await loadFixture(fixture);
    }

    let stack = await es.query(insts, { values });
    return [stack, es];
}

async function loadFixture(name: string) {
    const Path = require('path');
    const Fs = require('fs-extra');
    const path = Path.resolve(__dirname, `../fixtures/${name}.insts`);
    const data = await Fs.readFile(path, 'utf8');
    const parsed = parse(data);
    // Log.debug(parsed);
    // Log.debug(chessData);
    // assert.deepEqual(parsed, chessData);
    return parsed;
}

function ilog(...args) {
    const util = require('util');
    console.log(util.inspect(...args, { depth: null }));
}