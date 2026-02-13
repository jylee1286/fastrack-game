// Network Manager - PeerJS P2P Multiplayer
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

    // Generate a 6-character alphanumeric room code
    generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // Create a new game (host)
    createGame(onConnected, onDataReceived, onDisconnected) {
        this.isHost = true;
        this.onConnected = onConnected;
        this.onDataReceived = onDataReceived;
        this.onDisconnected = onDisconnected;

        // Generate room code
        this.roomCode = this.generateRoomCode();

        // Create peer with room code as ID
        this.peer = new Peer('fastrack-' + this.roomCode, {
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' }
                ]
            }
        });

        this.peer.on('open', (id) => {
            console.log('Host peer created with ID:', id);
        });

        this.peer.on('connection', (conn) => {
            console.log('Incoming connection from:', conn.peer);
            this.conn = conn;
            this.setupConnection();
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            // If the ID is taken, try with a new code
            if (err.type === 'unavailable-id') {
                this.roomCode = this.generateRoomCode();
                this.peer.destroy();
                return this.createGame(this.onConnected, this.onDataReceived, this.onDisconnected);
            }
            if (this.onDisconnected) {
                this.onDisconnected('Connection error: ' + err.type);
            }
        });

        return this.roomCode;
    }

    // Join an existing game
    joinGame(roomCode, onConnected, onDataReceived, onDisconnected) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase();
        this.onConnected = onConnected;
        this.onDataReceived = onDataReceived;
        this.onDisconnected = onDisconnected;

        // Create peer
        this.peer = new Peer({
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' }
                ]
            }
        });

        // Set a connection timeout
        const connectTimeout = setTimeout(() => {
            if (!this.connected) {
                console.error('Connection timed out');
                if (this.onDisconnected) {
                    this.onDisconnected('Connection timed out. Check the room code and try again.');
                }
            }
        }, 15000);

        this.peer.on('open', (id) => {
            console.log('Joiner peer created with ID:', id);
            console.log('Connecting to host:', 'fastrack-' + this.roomCode);
            // Connect to host
            this.conn = this.peer.connect('fastrack-' + this.roomCode, {
                reliable: true
            });
            this.setupConnection();
            
            // Clear timeout on successful connection setup
            this.conn.on('open', () => {
                clearTimeout(connectTimeout);
            });
        });

        this.peer.on('error', (err) => {
            clearTimeout(connectTimeout);
            console.error('Peer error:', err);
            let msg = 'Failed to connect';
            if (err.type === 'peer-unavailable') {
                msg = 'Room not found. Check the code and make sure the host is waiting.';
            } else if (err.type === 'network') {
                msg = 'Network error. Check your internet connection.';
            } else if (err.type === 'server-error') {
                msg = 'Server error. Try again in a moment.';
            }
            if (this.onDisconnected) {
                this.onDisconnected(msg);
            }
        });
    }

    // Set up connection event handlers
    setupConnection() {
        this.conn.on('open', () => {
            console.log('Connection established');
            this.connected = true;
            if (this.onConnected) {
                this.onConnected();
            }
        });

        this.conn.on('data', (data) => {
            if (this.onDataReceived) {
                this.onDataReceived(data);
            }
        });

        this.conn.on('close', () => {
            console.log('Connection closed');
            this.connected = false;
            if (this.onDisconnected) {
                this.onDisconnected('Opponent disconnected');
            }
        });

        this.conn.on('error', (err) => {
            console.error('Connection error:', err);
            if (this.onDisconnected) {
                this.onDisconnected('Connection error');
            }
        });
    }

    // Send data to opponent
    send(data) {
        if (this.connected && this.conn) {
            this.conn.send(data);
        }
    }

    // Disconnect and cleanup
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

// Create global network manager instance
const network = new NetworkManager();
