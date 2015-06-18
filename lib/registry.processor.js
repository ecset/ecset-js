'use strict';

var _ = require('underscore');
var Backbone = require('backbone');

var EntitySet = require('./entity_set');
var Registry = require('./registry');
var Query = require('./query/full');

_.extend( Registry.prototype, {
    /**
    *   Adds a new processor instance
    */
    addProcessor: function( processorModel, entitySet, options ){
        var self = this;
        var processor;
        var processorId;
        var processorAttrs;
        var processorOptions;
        
        var priority;
        var updateable;

        // var entitySet;
        options = (options || {});
        processorId = this.createId(); //processorModel.id || options.id;
        priority = _.isUndefined(options.priority) ? 0 : options.priority;
        updateable = _.isUndefined(options.update) ? true : options.update;

        

        processorAttrs = {id:processorId, priority:priority, updateable:updateable};
        processorOptions = {Model:processorModel,registry:this};

        

        if( entitySet ){
            processorAttrs.entitySet = entitySet;
        }

        

        // create the processor instance using either the passed processor, or the base
        // processor create function
        processor = (processorModel.create || EntityProcessor.create)(
            processorAttrs, processorOptions);

        processor.registry = this;

        if( processorModel && processorModel.onLoad ){
            processorModel.onLoad( this );
        }

        
        // create the entity filter(s) specified by the processor
        this._mapEntitySetToProcessor( entitySet, processor, options );
        
        // if the processor has event listeners defined, connect those to the entityset
        this._attachEntitySetEventsToProcessor( entitySet, processor );

        self.processors.add( processor );

        self.trigger('processor:add', processor );
        
        return processor;
    },

    /**
        creates a mapping between the entityset and the processor.
        the processor may specify a filter for the given entityset, so
        a view can be generated in that case.
        The given entitySet may also specify that it is not optimal for
        an update, so in that case a view will also be generated.

        Entity views are stored according to their hash, so that
        multiple processors may operate on the same set.

        - generate a hash for the required entitySet/entityFilter combination
        - if the hash already exists, then retrieve the mapping and add the
            processor to the list
        - if the hash doesn't exist, create the view from the src entityset
    */
    _mapEntitySetToProcessor: function( entitySet, processor, options ){
        var filter, hash, view, entitySetProcessors, debug;

        var record = new Backbone.Model({
            id: processor.id,
            entitySet: entitySet,
            processor: processor
        });

        debug = options.debug;

        // log.debug('adding processor ' + processor.type );
        // decide on which view (if any) to use with the processor
        if( processor.entityFilter ){

            // convert the supplied directives into entityFilter instances
            if( debug ){ log.debug('creating filter ' + processor.entityFilter ); }
            filter = Query.create( this, processor.entityFilter );

            // do we already have a view for this filter?
            hash = EntitySet.hash( entitySet, filter );
            if( debug ){ log.debug('hashed es query ' + hash + ' ' + filter.hash() + ' ' + JSON.stringify(filter) ); }

            if( this._entityViews[ hash ] ){
                view = this._entityViews[ hash ];
            } else {
                // query a view using the filter from the source entitySet
                view = entitySet.view( filter );

                this._entityViews[ hash ] = view;
                
                this.trigger('view:create', view);
                
                if( debug ) {log.debug('new view ' + view.cid + '/' + view.hash() 
                    + ' with filter ' + filter.hash() 
                    + ' has ' + entitySet.models.length 
                    + ' entities for ' + processor.type );}
            }

            // log.debug('setting view ' + view.cid + ' onto ' + processor.type );
            record.set('view', view);
            processor.set({
                view: view,
                entityFilter: filter,
                entitySet: entitySet
            });
        } else {
            record.set('view', entitySet);
            processor.set({
                'entitySet': entitySet,
                'view': entitySet
            });
        }

        processor.entitySet = entitySet;
        processor.view = view || entitySet;
        processor.entityFilter = filter;

        this.entitySetProcessors.add( record );

        // store the mapping between the entityset and the processor
        // an entityset can have multiple processors
        // entitySetProcessors = this.entitySetProcessors[ entitySet.id ] || createProcessorCollection();
        // entitySetProcessors.add( processor );
        // this.entitySetProcessors[ entitySet.id ] = entitySetProcessors;
    },

    _attachEntitySetEventsToProcessor: function( entitySet, processor ){
        var name;
        var event;
        if( !processor.events ){
            return;
        }
        
        for( name in processor.events ){
            event = processor.events[name];
            // curry the event function so that it receives the entity and the entityset as arguments
            processor.listenToAsync( entitySet, name, function(entity){
                var args = Array.prototype.slice.call( arguments, 1 );
                return event.apply( processor, [entity, entitySet ].concat( args ) );
            });

            // entitySet.listenToEntityEvent( null, name, function( entity ){
            //     var args = Array.prototype.slice.call( arguments, 1 );
            //     return event.apply( processor, [entity, entitySet ].concat( args ) );
            // });
        }
    },

    

    // update: function( callback ){
    //     var self = this;
    //     var now = Date.now();
    //     var dt = now - this.updateLastTime;
    //     this.updateLastTime = now;
    //     this.updateStartTime += dt;
    //     var updateOptions = {};

    //     this.trigger('processor:update:start', this);

    //     var current = Promise.fulfilled();

    //     return Promise.all( 
    //         this.processors.models.map( function(processor){
    //             return current = current.then(function() {
    //                 // log.debug('calling update ' + dt );
    //                 return processor.update( dt, self.updateStartTime, now, updateOptions );
    //             });
    //         })).then( function( results ){
    //             self.trigger('processor:update:finish', self );
    //         });
    // },

    update: function( timeMs, options ){
        var debug;
        options || (options={});
        debug = options.debug;

        return _.reduce( this.entitySetProcessors, function(current, record){
            return current.then(function(){
                var processor = record.get('processor');
                var view = processorRecord.get('view');
                var entityArray = view.models;

                if( !entityArray || entityArray.length === 0 ){ return processor; }

                return processor.onUpdate( entityArray, timeMs )
                    .then( function(){
                        return processor.applyChanges();
                    })
                    .then( function(){
                        if( view.isModified ){
                            return view.applyEvents();
                        }
                        return processor;
                    });
            });
        }, Promise.resolve() );
    },

    /**
    *   Updates the processors attached to each entityset
    */
    updateSync: function( timeMs, options ){
        var entitySet;
        var entitySetId;
        var entitySetProcessors;
        var debug;
        var i,l;

        options || (options={});
        debug = options.debug;
        
        if(debug){ log.debug('> registry.updateSync'); }

        // iterate through each of the entitysets which have processors
        this.entitySetProcessors.each( function(processorRecord){
            var processor = processorRecord.get('processor');
            var view = processorRecord.get('view');
            var entityArray = view.models;

            // dispatch any events that the processor has collected
            // from the last update loop
            if( processor.isListeningAsync ){
                processor.isReleasingEvents = true;
                processor.releaseAsync();
                processor.isReleasingEvents = false;
            }

            // execute any queued events that the processor has received
            if( debug ){ log.debug('executing processor ' + processor.type + ' ' + processor.get('priority') + ' with ' + view.cid +'/'+ view.hash() + ' ' + entityArray.length + ' entities'); }
            

            // if the view needs updating due to entities or components being 
            // added/updated/removed, then do so now
            // the view is updated /before/ it is updated - previously it was
            // after, but this might lead to dependent views/sets getting out of
            // sync
            view.applyEvents();
            
            // allow the processor to process the entities
            if( entityArray.length > 0 ){
                processor.onUpdate( entityArray, timeMs, options );
            }

            // apply any changes to the entitySet that the processor may have queued
            // changes involve adding/removing entities and components
            // NOTE: this includes creating and destroying entities - do we want to leave these ops till after all processors have run?
            processor.applyChanges();
        });
    },
});

module.exports = Registry;