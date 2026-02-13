// Network Manager - PeerJS P2P Multiplayer
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Open Relay TURN servers (free, by Metered)
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
        urls: 'turn:global.relay.metered.ca:80',
        username: 'e8dd65b92f6aee9de4a54917',
        credential: '5VpEpiKnhp/rJugL'
    },
    {
        urls: 'turn:global.relay.metered.ca:80?transport=tcp',
        username: 'e8dd65b92f6aee9de4a54917',
        credential: '5VpEpiKnhp/rJugL'
    },
    {
        urls: 'turn:global.relay.metered.ca:443',
        username: 'e8dd65b92f6aee9de4a54917',
        credential: '5VpEpiKnhp/rJugL'
    },
    {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: 'e8dd65b92f6aee9de4a54917',
        credential: '5VpEpiKnhp/rJugL'
    }
];

class NetworkManager {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.roomCode = null;
        this.isHost = false;
        this.connected = false;
        this.onConnected = null;
        this.onDataReceived = null;
        this.onDisconnected = null;
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0/O, 1/I)
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    createGame(onConnected, onDataReceived, onDisconnected) {
        this.isHost = true;
        this.onConnected = onConnected;
        this.onDataReceived = onDataReceived;
        this.onDisconnected = onDisconnected;
        this.roomCode = this.generateRoomCode();

        this.peer = new Peer('fastrack-' + this.roomCode, {
            debug: 1,
            config: { iceServers: ICE_SERVERS }
        });

        this.peer.on('open', (id) => {
            console.log('Host peer ready:', id);
        });

        this.peer.on('connection', (conn) => {
            console.log('Opponent connected');
            this.conn = conn;
            this.setupConnection();
        });

        this.peer.on('error', (err) => {
            console.error('Host peer error:', err.type, err);
            if (err.type === 'unavailable-id') {
                // ID taken, regenerate
                this.roomCode = this.generateRoomCode();
                this.peer.destroy();
                this.createGame(this.onConnected, this.onDataReceived, this.onDisconnected);
                return;
            }
            if (this.onDisconnected) {
                this.onDisconnected('Connection error: ' + err.type);
            }
        });

        return this.roomCode;
    }

    joinGame(roomCode, onConnected, onDataReceived, onDisconnected) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase().trim();
        this.onConnected = onConnected;
        this.onDataReceived = onDataReceived;
        this.onDisconnected = onDisconnected;

        this.peer = new Peer({
            debug: 1,
            config: { iceServers: ICE_SERVERS }
        });

        const connectTimeout = setTimeout(() => {
            if (!this.connected) {
                console.error('Connection timed out');
                if (this.onDisconnected) {
                    this.onDisconnected('Connection timed out. Make sure the host has created the game and the code is correct.');
                }
            }
        }, 20000);

        this.peer.on('open', (id) => {
            console.log('Joiner peer ready:', id);
            console.log('Connecting to:', 'fastrack-' + this.roomCode);
            
            this.conn = this.peer.connect('fastrack-' + this.roomCode, {
                reliable: true
            });
            
            this.conn.on('open', () => {
                clearTimeout(connectTimeout);
            });
            
            this.setupConnection();
        });

        this.peer.on('error', (err) => {
            clearTimeout(connectTimeout);
            console.error('Join peer error:', err.type, err);
            
            let msg = 'Failed to connect';
            if (err.type === 'peer-unavailable') {
                msg = 'Room not found. Check the code and make sure the host is waiting.';
            } else if (err.type === 'network') {
                msg = 'Network error. Check your internet connection and try again.';
            } else if (err.type === 'server-error') {
                msg = 'Server error. Try again in a moment.';
            } else if (err.type === 'disconnected') {
                msg = 'Disconnected from server. Retrying...';
                // Try to reconnect
                setTimeout(() => this.peer.reconnect(), 2000);
                return;
            }
            
            if (this.onDisconnected) {
                this.onDisconnected(msg);
            }
        });
    }

    setupConnection() {
        if (!this.conn) return;
        
        this.conn.on('open', () => {
            console.log('Connection established!');
            this.connected = true;
            if (this.onConnected) this.onConnected();
        });

        this.conn.on('data', (data) => {
            if (this.onDataReceived) this.onDataReceived(data);
        });

        this.conn.on('close', () => {
            console.log('Connection closed');
            this.connected = false;
            if (this.onDisconnected) this.onDisconnected('Opponent disconnected');
        });

        this.conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    }

    send(data) {
        if (this.connected && this.conn && this.conn.open) {
            try {
                this.conn.send(data);
            } catch (e) {
                console.error('Send error:', e);
            }
        }
    }

    disconnect() {
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connected = false;
        this.roomCode = null;
    }
}

const network = new NetworkManager();
