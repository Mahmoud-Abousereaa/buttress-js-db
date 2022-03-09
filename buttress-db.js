import { PolymerElement, html } from '@polymer/polymer/polymer-element';

import './buttress-db-data-service.js';
import './buttress-db-realtime-handler.js';

import FingerprintJS from './libs/fingerprint.js';

import { AppDb } from './buttress-db-schema.js';
import Worker from './buttress-db-worker.js';

import 'sugar/dist/sugar';

class ButtressInterface {
  constructor() {
    this._instance = null;

    this._searchLoadedCollection = {};
    this._searchHashMap = {};
  }

  get AppDb() {
    return AppDb;
  }

  bind(instance) {
    this._instance = instance;
  }

  /**
   * Proxy through to Polymer property-effects
   * @param  {...any} args
   * @return {*}
   */
  getPath(...args) {
    return this._instance.get(...args);
  }

  /**
   * Proxy through to Polymer property-effects
   * @param  {...any} args
   * @return {*}
   */
  setPath(...args) {
    return this._instance.set(...args);
  }

  /**
   * Proxy through to Polymer property-effects
   * @param  {...any} args
   * @return {*}
   */
  pushPath(...args) {
    return this._instance.push(...args);
  }

  /**
   * Load core app users
   * @param  {endpoint} string
   * @param  {token} string
   * @return {Promise}
   */
  _getCoreUsers(endpoint, token) {
    endpoint = endpoint + 'user';
    return this._coreRequest(endpoint, token);
  }

  /**
   * Load core app attributes
   * @param  {endpoint} string
   * @param  {token} string
   * @return {Promise}
   */
  _getCoreAttributes(endpoint, token) {
    endpoint = endpoint + 'attributes';
    return this._coreRequest(endpoint, token);
  }

  /**
   * Send a request to fetch core app schemas
   * @param  {endpoint} string
   * @param  {token} string
   * @return {Promise}
   */
  _coreRequest(endpoint, token) {
    return fetch(`${endpoint}?urq=${Date.now()}&token=${token}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    .then((response) => {
      if (response.ok) {
        return response.json();
      } else {
        // Handle Buttress Error
        throw new Error(`DS ERROR [CORE SCHEMAS] ${response.status} ${endpoint} - ${response.statusText}`);
      }
    })
    .catch((err) => {
      console.error(err);
    });
  }

  /**
   * Load core app schemas
   * @param  {host} string
   * @param  {token} string
   * @param  {apiPath} string
   * @return {Promise}
   */
  loadCoreSchemas(host, token, apiPath) {
    console.log(`get rq: core schemas request for app api path ${apiPath}`);
    const endpoint = `${host}/api/v1/`;
    const coreSchemas = {};
    return this._getCoreUsers(endpoint, token)
      .then((users) => coreSchemas.users = users)
      .then(() => this._getCoreAttributes(endpoint, token))
      .then((attributes) => {
        coreSchemas.attributes = attributes;
        return coreSchemas;
      })
  }

  /**
   * @param {string} collection
   * @param {string} id
   * @return {promise} entity
   */
  get(collection, id) {
    const dataService = this._instance.dataService(collection);
    if (!dataService) {
      return Promise.reject(new Error(`Unable to find data service ${collection}`));
    }

    const entity = this.getPath(`db.${collection}.data`).find((e) => e.id === id);
    if (entity) return Promise.resolve(entity);

    return dataService.getEntity(id);
  }


  /**
   * @param {string} collection
   * @return {promise} collection
   */
  getAll(collection) {
    // Check for hash
    if (this._searchLoadedCollection[collection]) {
      return Promise.resolve(false);
    }

    const dataService = this._instance.dataService(collection);
    if (!dataService) {
      return Promise.reject(new Error(`Unable to find data service ${collection}`));
    }

    this._searchLoadedCollection[collection] = true;

    return dataService.getAllEntities();
  }

  searchOnce(collection, query, limit, skip) {
    // Check for hash
    const hash = this._hashCollectionQuery(collection, query);
    if (this._searchHashMap[hash]) {
      return Promise.resolve(false);
    }

    return this.search(collection, query, limit, skip)
      .then((res) => {
        this._searchHashMap[hash] = true;
        return res;
      });
  }

  search(collection, query, limit, skip, sort, project) {
    const dataService = this._instance.dataService(collection);
    if (!dataService) {
      return Promise.reject(new Error(`Unable to find data service ${collection}`));
    }

    return dataService.search(query, limit, skip, sort, project);
  }

  count(collection, query) {
    const dataService = this._instance.dataService(collection);
    if (!dataService) {
      return Promise.reject(new Error(`Unable to find data service ${collection}`));
    }

    return dataService.count(query);
  }

  _hashCollectionQuery(collection, object) {
    const str = collection + JSON.stringify(object);

    var hash = 0;
    if (str.length == 0) {
        return hash;
    }
    for (var i = 0; i < str.length; i++) {
        var char = str.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }

    return hash;
  }
}
export const Buttress = new ButtressInterface();

export default class ButtressDb extends PolymerElement {
  static get is() { return 'buttress-db'; }

  static get template() {
    return html`
      <style>
        :host {
          display: none;
        }
      </style>

      <iron-ajax
        id="schema",
        url="[[endpoint]]/api/v1/app/schema",
        params="{{rqSchemaParams}}",
        handleAs="json",
        last-response="{{dbSchema}}",
        on-error="__dbSchemaError">
      </iron-ajax>

      <template id="dataServices" is="dom-repeat" items="{{__collections}}">
        <buttress-db-data-service
          id="[[item.name]]"
          token="[[token]]",
          api-path="[[apiPath]]",
          endpoint="[[endpoint]]",
          route="[[item.name]]",
          loaded="{{item.loaded}}",
          status="{{item.status}}",
          data="{{item.data}}",
          priority="[[item.priority]]",
          core="[[item.core]]",
          logging="[[logging]]",
          load-on-startup="[[item.loadOnStartup]]",
          settings="[[settings]]",
          auto-load>
        </buttress-db-data-service>
      </template>

      <buttress-db-realtime-handler
        token="[[token]]",
        endpoint="[[endpoint]]",
        user-id="[[userId]]",
        api-path="[[apiPath]]",
        db="{{db}}",
        connected="{{io.connected}}",
        synced="{{io.synced}}",
        logging="[[logging]]"
      ></buttress-db-realtime-handler>
    `;
  }

  static get properties() {
    return {
      endpoint: String,
      token: String,
      appId: String,
      apiPath: String,
      userId: String,

      logging: {
        type: Boolean,
        value: false
      },

      loaded: {
        type: Boolean,
        notify: true,
        value: false
      },
      loading: {
        type: Object,
        notify: true,
        value: function() {
          return {
            loaded: false,
            current: 0,
            total: 0
          }
        }
      },
      error: {
        type: Boolean,
        notify: true,
        value: false
      },
      lastError: {
        type: Object,
        notify: true,
      },

      rqSchemaParams: {
        type: Object
      },

      db: {
        type: Object,
        value: function() {
          return {};
        },
        notify: true
      },
      io: {
        type: Object,
        value: function() {
          return {
            connected: false,
            synced: true
          };
        },
        notify: true
      },

      __collections: {
        type: Object,
        value: function() {
          return [];
        },
        notify: true
      },

      loadOnStartup: {
        type: Array,
        value: function() {
          return [];
        },
      },

      settings: {
        type: Object,
        notify: true,
        value: function() {
          return {
            logging: false,
            worker: false,
            local_sync: false,
            local_read: false,
            network_sync: false,
            network_read: true,
            bundled_requests: true,
            bundled_requests_chunk: 100,
          };
        }
      },

      nonModuleDependencies: {
        type: Array,
        value: function() {
          return [{
            name: 'fingerprint',
            loaded: false,
            error: false
          }]
        }
      },

      __localDB: {
        type: Object
      },
      __worker: {
        type: Object
      },
      __workerTasks: {
        type: Object,
        value: function() {
          return {};
        }
      },
      __workerId: {
        type: Number,
        value: 1
      }
    };
  }

  static get observers() {
    return [
      '__tokenChanged(token, nonModuleDependencies.*)',
      '__dbSchemaChanged(loadOnStartup, dbSchema.*)',
      '__dbLoadingState(__collections.*)',
      '__settingChanged(settings.*)'
    ];
  }
  
  ready() {
    super.ready();
    this.addEventListener('data-service-ready', ev => this.__dataServiceReady(ev));

    Buttress.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    const settings = this.get('settings');

    if (FingerprintJS) {
      const depIdx = this.get('nonModuleDependencies').findIndex(d => d.name === 'fingerprint');
      this.set(`nonModuleDependencies.${depIdx}.loaded`, true);

      FingerprintJS.load()
        .then((fp) => fp.get())
        .then((result) => {
          AppDb.Fingerpint.machineId = result.visitorId
            .match(/.{1}/g)
            .map(n => parseInt(`0x${n}`, 16) > 7 ? 1 : 0)
            .reduce((prev, n,idx) => prev |= n << idx);
          AppDb.Fingerpint.processId = Math.floor(Math.random() * 100000) % 0xFFFF;
          AppDb.Fingerpint.inc = Math.floor(Math.random() * 65535) % 0xFFFF;
        });
    } else {
      const depIdx = this.get('nonModuleDependencies').findIndex(d => d.name === 'fingerprint');
      this.set(`nonModuleDependencies.${depIdx}.error`, true);
      this.set('error', true);
      this.set('lastError', new Error('Unable to load fingerprint, this is required for generating ids'));
      return;
    }

    this.set('db.Factory', AppDb.Factory);

    // Check local storage settings
    if ('localStorage' in window) {
      Object.keys(settings).forEach((key) => {
        const value = this.getOption(key);
        if (value === undefined || value === null) return; // Skip and use default
        this.set(`settings.${key}`, value);
        if (key === 'logging' && value === true) {
          this.set(`logging`, true);
        }
      });
    }
    
    if ('indexedDB' in window) {
      if (Worker && this.get('settings.worker')) {
        if (this.get('logging')) console.log('Talking to indexedDB via worker');
        const workerBlob = new Blob(['('+Worker.toString()+')()'], {type: 'application/javascript'});

        try {
          const dbWorker = Worker(URL.createObjectURL(workerBlob));
          dbWorker.onmessage = (ev) => this.__workerMessage(ev);
          dbWorker.onerror = (ev) => this.__workerError(ev);
          this.set('__worker', dbWorker);
        } catch (err) {
          console.error(err);
        }
      } else {
        if (this.get('logging')) console.log('Talking to indexedDB directly');
        this.set('__localDB', Worker());
      }
    }
  }

  __settingChanged(cr) {
    const path = cr.path.split('.');
    if (!path || path.length !== 2) return;
    path.shift();

    this.setOption(path, cr.value);
  }

  __dataServiceReady(ev){
    const collectionIdx = this.get('__collections').findIndex((c) => c.name === ev.detail);
    if (collectionIdx === -1) return;

    this.set(`__collections.${collectionIdx}.ready`, true);

    if (this.get('__collections').every((c) => c.ready)) {
      const stack = this.get('__collections').map((c) => () => this.dataService(c.name).load());
      this._loadDataService(stack)
        .then(() => {
          this.set('loaded', true);
          this.set('loading.loaded', true);
        });
    }
  }

  __dbLoadingState(cr) {
    if (!cr || !cr.path.match(/__collections.\d.loaded/)) return;
    this.set('loading.current', this.get('__collections').filter((c) => c.loaded).length);
    this.set('loading.percent', (this.get('loading.current') / this.get('loading.total')) * 100);
  }

  __tokenChanged() {
    const endpoint = this.get('endpoint');
    const token = this.get('token');
    const nonModuleDependencies = this.get('nonModuleDependencies');
    if (!token || nonModuleDependencies.some(d => d.loaded === false)){
      return;
    }

    // Fetch app schema using provided token
    return fetch(`${endpoint}/api/v1/app/schema?urq=${Date.now()}&token=${token}`, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then((response) => {
        console.log(response);

        if (response.ok) {
          return response.json();
        } else {
          // Handle Buttress Error
          throw new Error(`${response.status}: ${response.statusText}`);
        }
      })
      .then((schema) => this.set('dbSchema', schema))
      .catch((err) => {
        // will only reject on network failure or if anything prevented the request from completing.
        console.error(err);
        this.set('error', true);
        this.set('lastError', err);
      });
  }

  __dbSchemaChanged() {
    const schema = this.get('dbSchema');
    const loadOnStartup = this.get('loadOnStartup');
    if (!schema || schema.length < 1) return;

    AppDb.Schema.schema = schema;

    // Generate db data map
    schema.forEach(s => {
      const key = Sugar.String.camelize(s.name, false);
      const idx = this.push('__collections', {
        name: s.name,
        status: 'uninitialised',
        priority: 1,
        data: [],
        core: false,
        ready: false,
        loaded: false,
        loadOnStartup: (loadOnStartup.includes(s.name)) ? true : false,
      }) - 1;
      this.unlinkPaths(['db', key]);
      this.set(['db', key], this.get(['__collections', idx]));
      this.linkPaths(['db', key], `__collections.${idx}`);
    });

    this.set('loading.loaded', false);
    this.set('loading.current', 0);
    this.set('loading.total', this.get('__collections.length'));

    if (this.get('__localDB')) {
      console.log(this.get('__localDB'));
      const collections = [].concat(schema).map(c => Sugar.String.camelize(c.name, false));
      this.get('__localDB').init({
        task: 'init',
        name: 'Buttress',
        version: 1,
        collections: collections
      })
      .then(() => {
        if (this.get('settings.local_read') === true) {
          this.__localLoadCollections(collections)
            .then(result => {
              this.set('loaded', true);
              this.set('loading.loaded', true);
            })
        }
      });
    }

    if (this.get('__worker')) {
      const collections = [].concat(schema).map(c => Sugar.String.camelize(c.name, false));
      this.__workerTask({
        task: 'init',
        name: 'Buttress',
        version: 1,
        collections: collections
      })
      .then(() => {
        if (this.get('settings.local_read') === true) {
          this.__workerLoadCollections(collections)
            .then(result => {
              this.set('loaded', true);
              this.set('loading.loaded', true);
            })
        }
      });
    }
  }

  _loadDataService(stack, limit = 4) {
    const batchChain = [];
  
    const executeNext = (int) => {
      if (stack.length < 1) return Promise.resolve();
  
      const next = stack.shift();
      return next().then(() => executeNext(int));
    };
  
    for (let i = 0; i < limit; i++) {
      batchChain.push(executeNext(i));
    }

    console.log(batchChain);
  
    return Promise.all(batchChain);
  }

  dataService(collection) {
    return this.shadowRoot.querySelector(`#${collection}`);
  }

  // Local Storage
  getOption(key) {
    if (!'localStorage' in window) return false;
    const value = window.localStorage.getItem(`buttress_${key}`);
    return typeof value == 'string' ? JSON.parse(value) : value;
  }
  setOption(key, value) {
    if (!'localStorage' in window) return false;
    window.localStorage.setItem(`buttress_${key}`, value);
  }

  // Worker IO
  clearCollections() {
    let method = null;

    if (this.get('__localDB')) method = (payload) => this.get('__localDB').clear(payload);
    if (this.get('__worker'))  method = (payload) => this.__workerTask(payload);

    if (!method) return;

    const results = this.get('__collections').reduce((out, collection) => {
      const collectionName = Sugar.String.camelize(collection.name, false);
      console.time(`Cleared ${collectionName}`);
      const promise = method({
        task: 'clear',
        collection: collectionName
      })
      .then(() => {
        console.timeEnd(`Cleared ${collectionName}`);
      });

      out.push(promise);
      return out;
    }, []);

    return Promise.all(results);
  }

  saveCollections() {
    let method = null;

    if (this.get('__localDB')) method = (payload) => this.get('__localDB').bulkWrite(payload);
    if (this.get('__worker'))  method = (payload) => this.__workerTask(payload);

    if (!method) return;

    const results = this.get('__collections').reduce((out, collection) => {
      const collectionName = Sugar.String.camelize(collection.name, false);
      console.time(`Write ${collection.data.length} to ${collectionName}`);
      const promise = method({
        task: 'bulkWrite',
        collection: collectionName,
        items: collection.data
      })
      .then(() => {
        console.timeEnd(`Write ${collection.data.length} to ${collectionName}`);
      });

      out.push(promise);
      return out;
    }, []);

    return Promise.all(results);
  }

  __localLoadCollections(collections) {
    if (this.get('logging')) console.log('__localLoadCollections', collections.length);
    const load = (collection) => {
      if (this.get('logging')) console.log(`local ${collection} load`);
      console.time(`local ${collection} loaded`);
      return this.get('__localDB').readAll({
        task: 'readAll',
        collection: collection
      })
      .then(data => {
        console.timeEnd(`local ${collection} loaded`);
        this.set(['db', collection, 'data'], data);
        this.set(['db', collection, 'loaded'], true);
      });
    };

    return Promise.all(collections.map(load));
  }

  __workerLoadCollections(collections) {
    const load = (collection) => {
      console.time(`local ${collection} loaded`);
      return this.__workerTask({
        task: 'readAll',
        collection: collection
      })
      .then(data => {
        console.timeEnd(`local ${collection} loaded`);
        this.set(['db', collection, 'data'], data.result);
        this.set(['db', collection, 'loaded'], true);
      });
    }

    return Promise.all(collections.map(load));
  }

  __workerTask(payload) {
    payload.id = this.get('__workerId');

    this.get('__worker').postMessage(payload);

    this.set('__workerId', this.get('__workerId') + 1);

    return new Promise((resolve, reject) => {
      this.set(`__workerTasks.${payload.id}`, {
        id: payload.id,
        resolve: resolve,
        reject: resolve
      });
    });
  }

  __workerMessage(ev) {
    const workerTasks = this.get('__workerTasks');
    const payload = ev.data;

    if (payload.id && workerTasks[payload.id]) {
      workerTasks[payload.id].resolve(payload);
      delete workerTasks[payload.id];
      return;
    }

    if (this.get('logging') && !payload.type) console.log(payload);

    switch(payload.type) {
      default:
        if (this.get('logging')) console.log(payload);
        break;
    }
  }
  __workerError(ev) {
    if (this.get('logging')) console.error('__workerError', ev);
  }
}

window.customElements.define(ButtressDb.is, ButtressDb);
