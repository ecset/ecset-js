import { suite } from 'uvu';
import assert from 'uvu/assert';

import { bfToValues, Entity, getEntityId, createEntitySet, prepES } from '../helpers';

const test = suite('es/mem/query - Select');

test('fetches entities by id', async () => {
    const query = `[ 102 @e ] select`;
    const [stack] = await prepES(query, 'todo');

    // ilog(stack.items);
    const result = stack.popValue();

    // ilog( result );

    // the return value is an entity
    assert.equal(result.id, 102);
});

test('select no entities', async () => {
    const query = `
    [ 0 @eid /component/title#text @ca ] select
    `;
    const [stack] = await prepES(query, 'todo');

    // ilog(stack.items);
    const result = stack.popValue();

    // ilog( result );

    // the return value is an entity
    assert.equal(result, []);
});

test('select using eids', async () => {
    const [stack, es] = await prepES(
        `
    [
        [ 100 102 ]
        @c
    ] select
    `,
        'todo',
    );

    const eids = new Set(stack.popValue().map((c) => c['@e']));
    assert.equal(Array.from(eids), [100, 102]);
});

test('select condition using eids', async () => {
    const [stack, es] = await prepES(
        `
    [
        [ 100 102 ]
        /component/completed#/isComplete !ca true ==
        @c
    ] select
    `,
        'todo',
    );

    const eids = new Set(stack.popValue().map((c) => c['@e']));
    assert.equal(Array.from(eids), [100]);
});

test('select bf using eids', async () => {
    let id = 100;
    const idgen = () => ++id;
    const [stack, es] = await prepES(
        `
    [
        [ 100 109 ]
        /component/piece/pawn !bf
        @eid
    ] select
    `,
        'chess',
        { idgen },
    );

    assert.equal(stack.popValue(), [109]);
});

test('multi select condition using eids', async () => {
    const [stack, es] = await prepES(
        `
    [
        [ 100 102 ]
            /component/completed#/isComplete !ca true ==
            /component/priority#/priority !ca 10 ==
        and
        @c
    ] select
    `,
        'todo',
    );

    const eids = new Set(stack.popValue().map((c) => c['@e']));
    assert.equal(Array.from(eids), [100]);
});

test('fetches entities by did', async () => {
    const query = `[ "/component/completed" !bf @e] select`;
    const [stack] = await prepES(query, 'todo');

    // the result will be a list value of entities
    const result = stack.popValue();

    assert.equal(
        result.map((e) => getEntityId(e)),
        [100, 101, 102],
    );

    assert.equal(
        result.map((e) => bfToValues(e.bitField)),
        [
            [1, 2, 3, 4],
            [1, 2, 4],
            [1, 2, 4],
        ],
    );
});

test('fetches all the entities', async () => {
    const query = `[ all !bf @e ] select`;
    const [stack] = await prepES(query, 'todo');
    const result = stack.popValue();

    assert.equal(
        result.map((e) => e.id),
        [100, 101, 102, 103, 104, 105],
    );
});

test('fetches all the entities ids', async () => {
    const query = `[ all !bf @eid ] select`;
    const [stack] = await prepES(query, 'todo');
    const result = stack.popValue();

    assert.equal(result, [100, 101, 102, 103, 104, 105]);
});

test('fetches component ids', async () => {
    const query = `[ /component/title !bf @cid ] select`;
    const [stack] = await prepES(query, 'todo');
    const result = stack.popValue();

    assert.equal(result, ['[100,1]', '[101,1]', '[102,1]', '[103,1]', '[104,1]']);
});

test('fetches component attributes', async () => {
    const [stack] = await prepES(
        `[ 
                /component/title !bf
                @c
                /text pluck
            ] select`,
        'todo',
    );

    const result = stack.popValue();
    assert.equal(result, [
        'get out of bed',
        'phone up friend',
        'turn on the news',
        'drink some tea',
        'do some shopping',
    ]);
});

test('fetches entity component attribute', async () => {
    const [stack] = await prepES(
        `[ 
                103 @eid
                /component/title !bf
                @c
                /text pluck
            ] select pop`,
        'todo',
    );

    // ilog(stack.items);
    const result = stack.popValue();
    // ilog( result );
    assert.equal(result, 'drink some tea');
});

test('fetching components from unknown entity', async () => {
    const [stack] = await prepES(
        `
    [
        19999 @eid
        /component/title !bf
        @c
    ] select
    `,
        'todo',
    );

    assert.equal(stack.popValue(), []);
});

test('entity with all the components', async () => {
    const [stack, es] = await prepES(
        `
    [
        [ /component/title /component/priority ] !bf
        @eid
    ] select
    `,
        'todo',
    );

    assert.equal(stack.popValue(), [100, 104]);
});

test('entity without components', async () => {
    const [stack, es] = await prepES(
        `
    [
        /component/completed !bf !not
        @eid
    ] select
    `,
        'todo',
    );

    // console.log(es.getUrl());
    // await printAll(es);
    // console.log( es.componentDefs.map( d => `${d['@d']} ${d.url}`).join('\n') );
    assert.equal(stack.popValue(), [103, 104, 105]);
});

// test.only('match against both defs', async () => {
//     let id = 1000;
//     let idgen = () => ++id;
//     let q = `[
//             [ /component/title /component/priority ] !bf
//             @e
//             ] select`

//     let [stack,es] = await prepES(q, 'todo', {idgen});

//     stack.popValue().map( e => printEntity(es,e));
//     // let e: Entity = stack.popValue();

//     // assert.equal(e.size, 3);
//     // assert.equal(e.Colour.colour, 'white');
// });

test('fetching components with optional', async () => {
    const [stack] = await prepES(
        `
    [
        [/component/title /component/completed] !bf
        @c
    ] select
    /@e pluck unique
    rot [ *^$1 /component/priority !bf @c ] select rot +
    `,
        'todo',
    );

    assert.equal(stack.popValue().length, 7);
});

test('fetches component attributes', async () => {
    const [stack] = await prepES(
        `

        [ /component/title#text @ca ] select

    `,
        'todo',
    );
    const titles = stack.popValue();
    assert.equal(titles[2], 'turn on the news');
});

test('fetches component attribute from entitiy', async () => {
    const [stack] = await prepES(
        `

        [ 102 @eid /component/title#text @ca ] select pop!
    `,
        'todo',
    );
    const title = stack.popValue();
    assert.equal(title, 'turn on the news');
});

test('fetches matching component attribute', async () => {
    const [stack] = await prepES(
        `[ 
                // fetches values for text from all the entities in the es
                /component/title#/text !ca
                "do some shopping"
                // equals in this context means match, rather than equality
                // its result will be components
                ==
                /component/title !bf
                @c
            ] select
            `,
        'todo',
    );

    const coms = stack.popValue();
    assert.equal(coms[0].text, 'do some shopping');
});

test('fetches entities matching component attribute', async () => {
    const [stack] = await prepES(
        `[ 
                // fetches values for text from all the entities in the es
                /component/completed#/isComplete !ca
                true
                // equals in this context means match, rather than equality
                // its result will be components
                ==
                @e
            ] select`,
        'todo',
    );

    const ents = stack.popValue();

    assert.equal(
        ents.map((e) => getEntityId(e)),
        [100, 101],
    );
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
    nok ok rot size! 0 swap > iif
    `;

    const [stack] = await prepES(query, 'todo');
    // ilog( stack.popValue() );
    assert.equal(stack.popValue(), 'nok');
});

test('fetches matching attribute with regex', async () => {
    const [stack] = await prepES(
        `[ 
                /component/title#/text !ca ~r/some/ ==
                /component/title !bf
                @c
                /text pluck
            ] select`,
        'todo',
    );

    const result = stack.popValue();
    assert.equal(result, ['drink some tea', 'do some shopping']);
});

test('uses regex for minimum length', async () => {
    const [stack] = await prepES(
        `[ 
                /component/meta#/meta/author !ca ~r/^.{2,}$/ ==
                /component/title !bf
                @c
                /text pluck
            ] select`,
        'todo',
    );

    const result = stack.popValue();
    assert.equal(result, ['get out of bed', 'drink some tea']);
});

test('fetches by comparing a date', async () => {
    const [stack] = await prepES(
        `[ 
                /component/meta#/createdAt !ca ~d/2020-05-23T12:00:00.000Z/ <=
                // and
                /component/title !bf
                @c
                /text pluck
            ] select`,
        'todo',
    );

    const result = stack.popValue();
    assert.equal(result, ['get out of bed', 'turn on the news']);
});

test('uses multi conditions', async () => {
    const query = `[
            /component/position#/file !ca a ==
            /component/position#/rank !ca 2 ==
            and
            all
            @c
            ] select !e`;

    const [stack] = await prepES(query, 'chess');

    const e: Entity = stack.popValue();

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
    const query = `
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
            // exchange the result and the es
            swap
            // drop the original es
            drop 
            // add the result to the new es
            +
            `;

    const [stack] = await prepES(query, 'chess');

    const es = stack.popValue();

    assert.equal(await es.size(), 4);
});

test('super select', async () => {
    const [stack, es] = await prepES(
        `
            [
                uid !
                [ /component/username#/username !ca  $uid == ] select
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
            `,
        'irc',
    );

    // Log.debug( stack.toString() );
    assert.equal(stack.popValue(), '[ /component/channel_member { @e: 14 channel: 3 client: 11 } ]');
});

test('multi fn query', async () => {
    const [stack, es] = await prepES(
        `
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
            `,
        'irc',
    );

    const result = stack.popValue();
    const nicknames = result.map((v) => v.nickname);
    assert.equal(nicknames, ['missy', 'lauryn', 'koolgrap']);
});

test('selects a JSON attribute', async () => {
    const [stack] = await prepES(
        `
        [
            // where( attr('/component/meta#/meta/author').equals('av') )
            /component/meta#/meta/author !ca av ==
            /component/meta !bf
            @c
            /meta/tags/1 pluck
        ] select pop
        `,
        'todo',
    );

    // console.log( stack.items );
    const result = stack.popValue();
    // ilog( result );

    assert.equal(result, 'action');
});

test('selecting component by attribute', async () => {
    let id = 1000;
    const idgen = () => ++id;
    const es = createEntitySet({ idgen });

    const stmt = es.prepare(`
        [ "/component/src", ["url"] ] !d
        [ "/component/dst", ["url"] ] !d
        gather // wraps previous into a list
        + // add list to es

        [ /component/src {url: "file:///readme.txt"} ] !c
        [ /component/dst {url: "file:///about.txt"} ] !c
        gather
        +

        [ 
            /component/src#url !ca ~r/^file\:\/\// == 
            // note - without this bitfield, both components will be selected
            /component/src !bf
            @c 
        ] select
    `);

    const res = await stmt.getResult();

    assert.equal(res.length, 1);
    assert.equal(res[0].url, 'file:///readme.txt');
});

test('selecting component by attribute', async () => {
    let id = 1000;
    const idgen = () => ++id;
    const es = createEntitySet({ idgen });

    const stmt = es.prepare(`
        [ "/component/src", ["url"] ] !d
        [ "/component/dst", ["url"] ] !d
        gather // wraps previous into a list
        + // add list to es

        [ /component/src {url: "file:///readme.txt"} ] !c
        [ /component/dst {url: "file:///about.txt"} ] !c
        gather
        +

        [ 
            /component/src#url !ca ~r/^file\:\/\// == 
            // note - without this bitfield, both components will be selected
            /component/src !bf
            @c 
        ] select
    `);

    const res = await stmt.getResult();

    assert.equal(res.length, 1);
    assert.equal(res[0].url, 'file:///readme.txt');
});

test('and/or component', async () => {
    let id = 1000;
    const idgen = () => ++id;
    const es = createEntitySet({ idgen });

    const stmt = es.prepare(`
        [ "/component/src", ["url"] ] !d
        [ "/component/upd", [{name:op, type:integer}] ] !d
        [ "/component/site_ref", [{name:ref, type:integer}] ] !d
        gather // wraps previous into a list
        + // add list to es

        [ /component/src {url: "file:///about.txt"} ] !c
        [ /component/upd {op: 2} ] !c
        [ /component/site_ref {ref: 200} ] !c
        [ /component/src {url: "file:///misc/style.scss"} ] !c
        [ /component/upd {op: 1} ] !c
        [ /component/site_ref {ref: 200} ] !c
        gather
        +
        [ /component/src {url: "file:///readme.txt"} ] !c
        [ /component/upd {op: 1} ] !c
        [ /component/site_ref {ref: 300} ] !c
        gather
        +
        [ /component/src {url: "file:///style.scss"} ] !c
        [ /component/upd {op: 2} ] !c
        [ /component/site_ref {ref: 300} ] !c
        gather
        +

        [
            /component/src#url !ca ~r/.scss$/ ==
                    /component/upd#op !ca 1 ==
                    /component/upd#op !ca 2 ==
                or
                /component/site_ref#ref !ca $ref ==
            and
        and
        /component/src !bf
        @c ] 
        select

        // prints
    `);

    const res = await stmt.getResult({ ref: 200 });

    assert.equal(res.length, 1);
    assert.equal(res[0].url, 'file:///misc/style.scss');
});

test('bf or', async () => {
    let id = 1000;
    const idgen = () => ++id;
    const es = createEntitySet({ idgen });

    const stmt = es.prepare(`
    [ "/component/src", ["url"] ] !d
    [ "/component/dst", ["url"] ] !d
    gather +

    [ /component/src {url: "file:///about.txt"} ] !c
    gather +
    
    [ /component/dst {url: "file:///projects.txt"} ] !c
    gather +


    [
        [ /component/src /component/dst ] !bf !or
        @c
    ] select
    `);

    const res = await stmt.getResult();
    assert.equal(res.length, 2);
});

test('multi bitfield select', async () => {
    let id = 1000;
    const idgen = () => ++id;
    const es = createEntitySet({ idgen });

    const stmt = es.prepare(`
    [ "/component/src", ["url"] ] !d
    [ "/component/dst", ["url"] ] !d
    gather +

    [ /component/src {url: "file:///about.txt"} ] !c 
    [ /component/dst {url: "/about"} ] !c 
    gather +

    [ /component/src {url: "file:///projects.txt"} ] !c 
    [ /component/dst {url: "/projects"} ] !c 
    gather +
    
    [ /component/src {url: "file:///contact.txt"} ] !c 
    gather +

    [
        // select eids which have both /src and /dst
        [ /component/src /component/dst ] !bf @eid

        // select just /src
        // this is an arg of @c
        /component/src !bf
        @c
    ] select

    /url pluck!
    `);

    const res = await stmt.getResult();
    assert.equal(res, ['file:///about.txt', 'file:///projects.txt']);
});

test.run();
