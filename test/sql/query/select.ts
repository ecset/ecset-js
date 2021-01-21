import { suite } from 'uvu';
import assert from 'uvu/assert';

import {
    beforeEach,
    bfToValues,
    Entity,
    getEntityId,
    prepES,
} from '../helpers';


let test = suite('es/mem/query - Select');

test.before.each( beforeEach );

test('fetches entities by id', async () => {
    let query = `[ 102 @e ] select`;
    let [stack] = await prepES(query, 'todo');

    // ilog(stack.items);
    let result = stack.popValue();

    // ilog( result );

    // the return value is an entity
    assert.equal(result.id, 102);
});

test('select no entities', async () => {
    let query = `
    [ 0 @eid /component/title#text @ca ] select
    `;
    let [stack] = await prepES(query, 'todo');

    // ilog(stack.items);
    let result = stack.popValue();

    // ilog( result );

    // the return value is an entity
    assert.equal(result, [] );
});


test('fetches entities by did', async () => {
    let query = `[ "/component/completed" !bf @e] select`;
    let [stack] = await prepES(query, 'todo');

    // the result will be a list value of entities
    let result = stack.popValue();

    assert.equal(
        result.map(e => getEntityId(e)),
        [100, 101, 102]);

    assert.equal(
        result.map(e => bfToValues(e.bitField)),
        [[1, 2, 3, 4], [1, 2, 4], [1, 2, 4]]);
});

test('fetches all the entities', async () => {
    let query = `[ all !bf @e ] select`;
    let [stack] = await prepES(query, 'todo');
    let result = stack.popValue();

    assert.equal(result.map(e => e.id), [100, 101, 102, 103, 104, 105]);
})

test('fetches all the entities ids', async () => {
    let query = `[ all !bf @eid ] select`;
    let [stack] = await prepES(query, 'todo');
    let result = stack.popValue();

    assert.equal( result, [100, 101, 102, 103, 104, 105] );
})


test('fetches component attributes', async () => {
    let [stack] = await prepES(`[ 
                /component/title !bf
                @c
                /text pluck
            ] select`, 'todo');

    let result = stack.popValue();
    assert.equal(result, [
        'get out of bed',
        'phone up friend',
        'turn on the news',
        'drink some tea',
        'do some shopping'
    ])
});

test('fetches entity component attribute', async () => {
    let [stack] = await prepES(`[ 
                103 @eid
                /component/title !bf
                @c
                /text pluck
            ] select`, 'todo');

    // ilog(stack.items);
    let result = stack.popValue();
    // ilog( result );
    assert.equal(result, 'drink some tea');
})

test('fetching components from unknown entity', async () => {
    let [stack] = await prepES(`
    [
        19999 @eid
        /component/title !bf
        @c
    ] select
    `, 'todo');

    assert.equal( stack.popValue(), [] );
});


test('fetching components with optional', async () => {
    let [stack] = await prepES(`
    [
        [/component/title /component/completed] !bf
        @c
    ] select
    // prints
    /@e pluck!  unique
    // prints
    rot [ *^$1 /component/priority !bf @c ] select rot +
    // prints
    `, 'todo');

    assert.equal( stack.popValue().length, 7 );
});

test('fetches component attributes', async () => {
    let [stack] = await prepES(`

        [ /component/title#text @ca ] select

    `, 'todo');
    let titles = stack.popValue();
    assert.equal( titles[2], 'turn on the news' );
});

test('fetches component attribute from entitiy', async () => {
    let [stack] = await prepES(`

        [ 102 @eid /component/title#text @ca ] select pop!
    `, 'todo');
    let title = stack.popValue();
    assert.equal( title, 'turn on the news' );
});

test('fetches matching component attribute', async () => {
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

    let coms = stack.popValue();
    assert.equal(coms[0].text, "do some shopping");
});

test('fetches entities matching component attribute', async () => {
    let [stack] = await prepES(`[ 
                // fetches values for text from all the entities in the es
                /component/completed#/isComplete !ca
                true
                // equals in this context means match, rather than equality
                // its result will be components
                ==
                @e
            ] select`, 'todo');

    let ents = stack.popValue();

    assert.equal(ents.map(e => getEntityId(e)), [100, 101]);
});

test('testing whether entity has a component', async () => {
    const query = `
    // select a particular entity - result is an array with the eid
    [ /component/title#/text !ca "turn on the news" == ] select
    
    // make sure the es is top of the stack
    swap
    
    // select the component from the entity
    [ ^$1 /component/priority !bf @c ] select

    // if the result contains the component, return ok, otherwise nok
    nok ok rot size 0 swap > iif
    `;

    let [stack] = await prepES(query, 'todo');
    // ilog( stack.popValue() );
    assert.equal( stack.popValue(), 'nok' );
});


test('fetches matching attribute with regex', async () => {
    let [stack] = await prepES(`[ 
                /component/title#/text !ca ~r/some/ ==
                /component/title !bf
                @c
                /text pluck
            ] select`, 'todo');

    let result = stack.popValue();
    assert.equal(result, [
        'drink some tea',
        'do some shopping'
    ])
});

test('uses regex for minimum length', async () => {
    let [stack] = await prepES(`[ 
                /component/meta#/meta/author !ca ~r/^.{2,}$/ ==
                /component/title !bf
                @c
                /text pluck
            ] select`, 'todo');

    let result = stack.popValue();
    assert.equal(result, [
        'get out of bed',
        'drink some tea'
    ])
});

test('fetches by comparing a date', async () => {
    let [stack] = await prepES(`[ 
                // /component/meta#/createdAt !ca ~d/2020-05-23T10:00:00.000Z/ >=
                /component/meta#/createdAt !ca ~d/2020-05-23T12:00:00.000Z/ <=
                // and
                /component/title !bf
                @c
                /text pluck
            ] select`, 'todo');

    let result = stack.popValue();
    assert.equal(result, [
        'get out of bed',
        'phone up friend',
        'turn on the news',
    ])
});



test('uses multi conditions', async () => {
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


// test.only('and condition with failing', async () => {
//     let query = `
//     [
//         /component/position#/file !ca a ==
//         /component/position#/rank !ca 2 ==
//         and
//         all
//         @c
//     ] select
//     prints
//     `;

//     let [stack] = await prepES(query, 'chess');

//     let e: Entity = stack.popValue();

//     assert.equal(e.size, 3);
//     assert.equal(e.Colour.colour, 'white');
// });

test('and/or condition', async () => {
    let query = `
            // create an es with the defs
            @d
            {} !es
            swap
            + // add defs to new es
            swap
            [
                /component/position#/file !ca a ==
                /component/position#/file !ca f ==
                or
                /component/colour#/colour !ca white ==
                and
                @c
            ] select
            // prints
            // exchange the result and the es
            swap
            // drop the original es
            drop 
            // add the result to the new es
            +
            `;

    let [stack] = await prepES(query, 'chess');

    let es = stack.popValue();

    assert.equal(await es.size(), 4);
});

test('super select', async () => {
    let [stack, es] = await prepES(`
            [
                uid !
                [ /component/username#/username !ca  $uid == ] select
                // $es [ /component/username#/username !ca  $uid == ] select
                0 @
                
            ] selectUserId define
            
            [
                ch_name !
                // adding * to a ^ stops it from being eval'd the 1st time, but not the 2nd
                [ /component/channel#/name !ca $ch_name == ] select
                0 @
            ] selectChannelId define
            
            ggrice selectUserId 
            swap // so the es is now at the top
            
            "mr-rap" selectChannelId

            // get rid of the es
            swap drop
            
            // compose a new component which belongs to the 'mr-rap' channel
            [ "/component/channel_member" { "@e":14, channel: ^^$0, client: ^^$0 } ]

            to_str
            `, 'irc');

    // Log.debug( stack.toString() );
    assert.equal(stack.popValue(),
        '["/component/channel_member", {"@e": 14,"channel": 3,"client": 11}]');
})

test('multi fn query', async () => {
    let [stack, es] = await prepES(`
            es let
            [
                client_id let
                $es [
                    /component/channel_member#/client !ca $client_id ==
                    /component/channel_member !bf
                    @c
                ] select

                // pick the channel attributes
                /channel pluck 
            ] selectChannelsFromMember define

            [
                channel_ids let
                $es [
                    /component/channel_member#/channel !ca $channel_ids ==
                    /component/channel_member !bf
                    @c
                ] select

                // select client attr, and make sure there are no duplicates
                /client pluck unique 
                
                // make sure this list of clients doesnt include the client_id
                [ $client_id != ] filter

            ] selectChannelMemberComs define

            [
                eids let
                $es [ $eids [/component/nickname] !bf @c ] select
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
    assert.equal(nicknames, ['missy', 'lauryn', 'koolgrap']);
});




test('selects a JSON attribute', async () => {
    let [stack] = await prepES(`
        [
            // where( attr('/component/meta#/meta/author').equals('av') )
            /component/meta#/meta/author !ca av ==
            /component/meta !bf
            @c
            /meta/tags/1 pluck
        ] select
        `, 'todo');

    // console.log( stack.items );
    const result = stack.popValue();
    // ilog( result );

    assert.equal(result, 'action');
});

test.run();