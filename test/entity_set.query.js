export default function run( test, Common, Elsinore, EntitySet ){

    var Component = Elsinore.Component;
    var Entity = Elsinore.Entity;
    var Query = Elsinore.Query;

    test.skip('excluding', t => {
        let f = EntityFilter.create();
        let e = createEntity( {_c:Components.Animal, colour:'orange'}, {_c:Components.Robot, age:41} );


        // {
        //     entity: [{_c:Components.Animal, colour:'orange'}, {_c:Components.Robot, age:41}],
        //     ok: [ EntityFilter.EXCLUDE, Components.Animal ]
        // }


        EntityFilter.accept( e, EntityFilter.EXCLUDE, Components.Animal );

        // f.add( [ Query.FILTER, Query.ROOT, [ Query.EXCLUDE, Components.Animal] ] );

        t.ok( f.accept( e ) );

        t.end();
    });

    // test('calling query returns a Query object', t => {
    //     let registry = Common.initialiseRegistry(false);
    //     let entitySet = Common.loadEntities( registry );

    //     let query = entitySet.query("/component/status");

    //     t.ok( Query.isQuery(query), 'the result is an instance of Query' );

    //     let result = query.execute();

    //     t.ok( EntitySet.isEntitySet(result) );
    //     t.equal( result.size(), 3 );

    //     t.end();
    // });

    // test('query filtering by component attribute', t => {
    //     let registry = Common.initialiseRegistry(false);
    //     let entitySet = Common.loadEntities( registry );

    //     let result = entitySet
    //         .query('/component/status')
    //         .filter( entity => entity.Status.get('status') == 'active' )
    //         //.filter( Query.component('/component/status').attr('status').equals('active') )
    //         .execute();

    //     t.equal( result.size(), 2 );

    //     t.end();
    // });


    test.skip('retrieving referenced entities', t => {
        let registry = Common.initialiseRegistry(false);
        let entitySet = Common.loadEntities( registry, 'query.entities' );

        let result = entitySet
            // select all entities which have the ChannelMember component
            .query('/component/channel_member')
            // filter those ChannelMember entities to those which have a value of 11 for the 'client' attribute
            // the filter gets applied to each entity in the selected set
            .filter( entity => entity.ChannelMember.get('client') === 11 )
            .filter( Query.component('/component/channel_member').attr('client').eq(11) )
            // (==, value(/component/channel_member(client)), value(11))
            // selects all the values for the attributes channel and client in the /component/channel_member component
            // and then uses those values to add entities into the result using the top level entitySet.
            // if we had missed out the last argument, it would select entities from the current filter
            .addEntities( 
                Query.component('/component/channel_member').attr('client','channel'), entitySet )
            // value(/component/channel_member(client,channel))
            .execute();

        // filterEntities( rootEntitySet, /component/channel_member)
        // -- the working set now has entities with /channel_member components
        // filterEntities( `prev`, (==, value(/component/channel_member(client)), value(11))
        // -- the working set now has the entity with a channel_member.client value of 11
        // addEntities( rootEntitySet, value(/component/channel_member(client,channel)) )
        // -- into the working set we add additional entities selected 


        printE( result );
        // the result should have 3 entities - channel_member, channel and client
        t.equal( result.size(), 3 );

        t.end();
    });

    // test('EQ op', t => {
    //     let registry = Common.initialiseRegistry(false);
    //     let entitySet = Common.loadEntities( registry, 'query.entities' );

    //     let result = Query.execute( entitySet, [ Query.EQUALS, '/component/topic', 'topic' ] );

    //     t.equals( result,
    //         [Query.VALUE, ['Entity Component Systems', 'Javascript', 'Welcome to Politics']] );

    //     t.end();
    // });

    test('entityset filter ALL', t => {
        let registry = Common.initialiseRegistry(false);
        let entitySet = Common.loadEntities( registry, 'query.entities' );

        let result = Query.execute( entitySet, [ Query.ALL, Query.ROOT, '/component/mode/invite_only'] );

        t.equal( result[0], Query.VALUE );
        t.ok( EntitySet.isEntitySet(result[1]) );
        t.ok( result[1].size(), 1 );

        t.end();
    });

    test('EQUALS op', t => {
        t.deepEqual(
            Query.execute( null, [ Query.EQUALS, 8, 8 ] ), [ Query.VALUE, true ] );
        t.deepEqual(
            Query.execute( null, [ Query.EQUALS, 8, [ Query.VALUE, [1,3,5,8] ] ] ), [ Query.VALUE, true ] );
        t.end();
    })

    test('entityset filter by attribute', t => {
        let registry = Common.initialiseRegistry(false);
        let entitySet = Common.loadEntities( registry, 'query.entities' );

        // select entities which have the component /channel_member and 
        //  have the client attribute
        let result = Query.execute( entitySet, 
            [ Query.FILTER,
                Query.ROOT, //[ Query.ALL, Query.ROOT, '/channel_member' ], 
                [ Query.EQUALS, 
                    [ Query.ATTR, '/component/channel_member', 'client' ],
                    [ Query.VALUE, 5 ] ] ], {debug:false} );

        // printIns( result[1], 1 );
        // printE( result[1] );
        t.ok( result[1].size(), 2 );
        t.end();
    });

    test('entityset filter by attribute being within a value array', t => {
        let registry = Common.initialiseRegistry(false);
        let entitySet = Common.loadEntities( registry, 'query.entities' );

        // select entities which have the component /channel_member and 
        //  have the client attribute
        let result = Query.execute( entitySet, 
            [ Query.FILTER,
                Query.ROOT, //[ Query.ALL, Query.ROOT, '/channel_member' ], 
                [ Query.EQUALS, 
                    [ Query.ATTR, '/component/channel_member', 'channel' ],
                    [ Query.VALUE, [2, 4] ] ] ] );

        // printE( result[1] );
        t.ok( result[1].size(), 3 );
        t.end();
    });

    test('PLUCK op', t => {
        let registry = Common.initialiseRegistry(false);
        let entitySet = Common.loadEntities( registry, 'query.entities' );

        let result = Query.execute( entitySet, [ Query.PLUCK, Query.ROOT, '/component/topic', 'topic' ] );

        t.deepEqual( result,
            [Query.VALUE, ['Entity Component Systems', 'Javascript', 'Welcome to Politics']] );

        t.end();
    });


    test('ALIAS op', t => {
        let result = Query.execute( null,[
            [ Query.ALIAS, 'channelIds', [ Query.VALUE, [ 9, 10, 11 ]] ],
            [ Query.EQUALS,
                [ Query.VALUE, [ 9, 10, 11 ] ],
                [ Query.ALIAS, [ Query.VALUE, 'channelIds' ] ]] ] ); 

        t.deepEqual( result,  [Query.VALUE, true] );

        t.end();
    });


    test('sub-queries', t => {
        let registry = Common.initialiseRegistry(false);
        let entitySet = Common.loadEntities( registry, 'query.entities' );
        let clientId = 5;
        // query consists of two parts:
        // - /channel_member components which have the client attr set to `clientId` are
        //   selected.
        // - the channel attr from /channel_member is plucked out and placed into the alias `channelIds`
        // - /channel_member components are selected which have their channel_ref attribute match one
        //   of the values from the previously saved channelIds array
        // let result = entitySet
        //     .query()
        //         .where( 
        //             Query.component('/component/channel_member')
        //                 .attr('client')
        //                 .equals(clientId) )
        //         .pluck( '/component/channel_member', 'channel' )
        //         .as( 'channelIds' )
        //     .query()
        //         .filter( 
        //             Query.component('/component/channel_member')
        //                 .attr('channel_ref')
        //                 .equals( 
        //                     Query.alias('channelIds') ))
        //         .execute();
        let result = Query.execute( entitySet,[
            
            // 1. select channel ids which client `clientId` belongs to and store as alias `channelIds`
            [ Query.ALIAS, // alias op1 to op2
                'channelIds', // name of the alias to set
                [ Query.PLUCK, // select the attributes from op2
                    [ Query.FILTER, // select a subset of entities in op1 by using op2
                        [ Query.ALL, Query.ROOT, '/component/channel_member' ], 
                        [ Query.EQUALS, 
                            [ Query.ATTR, '/component/channel_member', 'client' ],
                            [ Query.VALUE, clientId ] ] ], 
                    '/component/channel_member', // components
                    'channel' ]], // attributes
            // [ Query.DEBUG, true ],
            [ Query.PRINT, 'channelIds are', [ Query.ALIAS, 'channelIds' ] ],

            // 2. select channel members which belong to the channel ids stored in the alias `channelIds`
            [ Query.FILTER,
                [ Query.ALL, Query.ROOT, '/component/channel_member' ],
                [ Query.EQUALS, 
                    [ Query.ATTR, '/component/channel_member', 'channel' ],
                    [ Query.ALIAS, 'channelIds' ] ] ] 

            // 3. using the channel_member client ids, select an entityset of client entities
            ], {debug:true} ); 
        
        // printIns( result[1], 1 );
        // printE( result[1] );
        // the result should have 3 entities - channel_member, channel and client
        // t.equal( result.size(), 3 );
        t.equal( result[1].size(), 5 );

        t.end();
    })
}


// serverside only execution of tests
if( !process.browser ){
    let Elsinore = require('../lib');
    run( require('tape'), require('./common'), Elsinore, Elsinore.EntitySet );
}