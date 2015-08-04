'use strict';

var _ = require('underscore');
var test = require('tape');

var Common = require('../common');
var Elsinore = Common.Elsinore;


//
// Original example from https://github.com/BlackDice/scent
//
test('main', function(t){
    let cDoor;
    return initialise().then( ([registry,entitySet]) => {
        return registry.registerComponent({
            id:'/door', 
            properties:{
                open:{type:'boolean'}, 
                material:{type:'string'} 
            } 
        })
        .then( cDef => {
            return [cDef,registry, entitySet];
        })
    })
    .then( ([cDoor, registry, entitySet]) => {
        var entitySet;
        var eDoor;
        var door;
        var processor;
        var registry;
        var DoorProcessor;

        // registry = Elsinore.Registry.create();
        // entitySet = registry.createEntitySet();
        // cDoor = registry.registerComponent({
        //     id:'/door', 
        //     properties:{
        //         open:{type:'boolean'}, 
        //         material:{type:'string'} 
        //     } 
        // });
        
        DoorProcessor = Elsinore.EntityProcessor.extend({
            // handle entity events
            events:{
                'doorOpen': function( entity, entitySet ){
                    entity.Door.set('open', Date.now());
                }
            },

            closingTime: {
                'wood': 200,
                'metal': 300,
                'stone': 500
            },

            onUpdate: function( entityArray, timeMs ){
                var entity, i, len;
                var closeTime;
                
                for( i=0,len=entityArray.length;i<len;i++ ){
                    entity = entityArray[i];
                    closeTime = this.closingTime[ entity.Door.get('material') ];
                    if (timeMs >= entity.Door.get('open') + closeTime ) {
                        entity.Door.set({open:false});
                    }
                }
            }
        });

        

        // attach the processor to the entityset. the priority will
        // be normal
        processor = registry.addProcessor( DoorProcessor, entitySet );
        
        door = registry.createComponent( cDoor, {material: 'wood'} );
        
        // adding the component to the entityset will create an entity
        entitySet.addComponent( door );

        // retrieve the first (and only entity) from the set
        eDoor = entitySet.at( 0 );

        // trigger an event on the entity set - this will open all door
        // components
        eDoor.triggerEntityEvent( 'doorOpen' );

        // an update has to occur for events to be processed
        registry.updateSync();

        // as a result of the event, the door should now be open
        t.assert( eDoor.Door.get('open'), 'the door should be open' );

        // run an update over all the entitysets in the registry - passing a
        // specific update time
        registry.updateSync( Date.now() + 300 );

        // as a result of the processor update, the door should now be closed
        t.assert( eDoor.Door.get('open') === false, 'the door should be closed' );

        t.end();
    })
    .catch( err => { log.debug('error: ' + err ); log.debug( err.stack );} )
});


function initialise(){
    return Common.initialiseRegistry().then( registry => {
        var entitySet = registry.createEntitySet();
        var entities = Common.loadEntities( registry );
        return [registry,entitySet,entities];    
    });
}


