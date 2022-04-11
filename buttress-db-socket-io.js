import { PolymerElement, html } from '@polymer/polymer/polymer-element.js';

import './libs/socket.io.js';

export class ButtressDbSocketIo extends PolymerElement {
  static get is() { return 'buttress-db-socket-io'; }

  static get template() {
    return html`
      <style>
        :host {
          display: none;
        }
      </style>
    `;
  }

  static get properties() {
    return {
      token: String,
      endpoint: String,
      appId: String,
      apiPath: String,

      logging: {
        type: Boolean,
        value: false
      },

      _scriptDependencyLoaded: {
        type: Boolean,
        value: false
      },

      connected: {
        type: Boolean,
        notify: true,
        value: false
      },
      rxEvents: {
        type: Array,
        value: function() {
          return [
            'db-activity',
            'db-disconnect-room'
          ];
        }
      },
      tx: {
        type: Array,
        value: function() {
          return [];
        }
      },
      rx: {
        type: Array,
        value: function() {
          return [];
        }
      }
    };
  }
  static get observers() {
    return [
      '__tokenChanged(token, _scriptDependencyLoaded)',
      '__tx(tx.splices)'
    ]
  }

  connectedCallback() {
    super.connectedCallback();

    if (io) {
      this.set('_scriptDependencyLoaded', true);
    } else {
      this.set('connected', false);
      this.dispatchEvent(new CustomEvent('error', {detail: new Error('Failed to load Socket IO Library'), bubbles: true, composed: true}));
    }
  }

  __tokenChanged() {
    const token = this.get('token');
    const scriptDependencyLoaded = this.get('_scriptDependencyLoaded');
    if (!token || !scriptDependencyLoaded) {
      // io.disconnect();
      return;
    }

    this.connect();
  }

  connect() {
    const token = this.get('token');
    const apiPath = this.get('apiPath');

    const uri = (apiPath) ? `${this.endpoint}/${apiPath}` : `${this.endpoint}`;

    if (this.get('logging')) console.log('debug', 'Attempting Socket connection', uri);
    try {
      this.socket = io.connect(uri, {
        query: {
          token: token
        }
      });
      this.socket.on('connect',() => {
        this.set('connected', true);
        if (this.get('logging')) console.log('debug', 'Connected');
        this.__configureRxEvents();
      });
      this.socket.on('disconnect',() => {
        this.set('connected', false);
      });
    } catch (err) {
      this.set('connected', false);
      if (this.get('logging')) console.log('err', err);
      this.dispatchEvent(new CustomEvent('error', {detail: err, bubbles: true, composed: true}));
    }
  }

  __configureRxEvents() {
    this.rxEvents.forEach(ev => {
      if (this.get('logging')) console.log('debug', '__configureRxEvents', ev);
      this.socket.on(ev, (data) => {
        if (this.get('logging')) console.log('debug', 'rxEvents:');
        if (this.get('logging')) console.log('debug', data);
        this.dispatchEvent(new CustomEvent('rx-event', {
          detail: Object.assign({}, { type: ev, payload: data }),
          bubbles: true
        }));
      });
    });
  }

  __tx(cr) {
    if (!this.socket) {
      return;
    }

    if (this.get('logging')) console.log('debug', cr);

    cr.indexSplices.forEach(i => {
      if (i.type !== 'splice' || i.addedCount === 0) {
        return;
      }
      if (this.get('logging')) console.log('debug', 'tx.added');

      for (let x=0; x<i.addedCount; x++) {
        let o = i.object[x+i.index];
        if (this.get('logging')) console.log('debug', `emitting: ${o.type}`);
        this.socket.emit(o.type, o.payload);
      }
    });
  }
}
window.customElements.define(ButtressDbSocketIo.is, ButtressDbSocketIo);
