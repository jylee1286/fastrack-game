// Network Manager - Supabase Realtime Broadcast
// Uses Supabase Realtime channels for cross-device multiplayer (no P2P needed)

const SUPABASE_URL = 'https://bihdbzbmqmgtrsipjywo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpaGRiemJtcW1ndHJzaXBqeXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5MTQsImV4cCI6MjA4NjUxMzkxNH0.F_mjiIIgqE6JtFHhOhk5twuOFdZLSvVIpOwCKJK6nbs';

class NetworkManager {
    constructor() {
        this.supabase = null;
        this.channel = null;
        this.roomCode = null;
        this.isHost = false;
        this.connected = false;
        this.playerId = Math.random().toString(36).substr(2, 9);
        this.onConnected = null;
        this.onDataReceived = null;
        this.onDisconnected = null;
    }

    async initSupabase() {
        if (this.supabase) return;
        
        const { createClient } = supabase;
        this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            realtime: {
                params: { eventsPerSecond: 40 }
            }
        });
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    async createGame(onConnected, onDataReceived, onDisconnected) {
        this.isHost = true;
        this.onConnected = onConnected;
        this.onDataReceived = onDataReceived;
        this.onDisconnected = onDisconnected;
        this.roomCode = this.generateRoomCode();

        await this.initSupabase();

        // Create a realtime channel for this room
        this.channel = this.supabase.channel('fastrack-' + this.roomCode, {
            config: {
                broadcast: { self: false }
            }
        });

        // Listen for game data
        this.channel.on('broadcast', { event: 'game' }, (payload) => {
            if (payload.payload.senderId !== this.playerId && this.onDataReceived) {
                this.onDataReceived(payload.payload.data);
            }
        });

        // Listen for player join
        this.channel.on('broadcast', { event: 'join' }, (payload) => {
            if (payload.payload.senderId !== this.playerId) {
                console.log('Opponent joined!');
                this.connected = true;
                // Send confirmation
                this.channel.send({
                    type: 'broadcast',
                    event: 'confirmed',
                    payload: { senderId: this.playerId }
                });
                if (this.onConnected) this.onConnected();
            }
        });

        // Listen for player leave
        this.channel.on('broadcast', { event: 'leave' }, (payload) => {
            if (payload.payload.senderId !== this.playerId) {
                this.connected = false;
                if (this.onDisconnected) this.onDisconnected('Opponent disconnected');
            }
        });

        // Subscribe
        const status = await this.channel.subscribe();
        console.log('Host channel status:', status);

        return this.roomCode;
    }

    async joinGame(roomCode, onConnected, onDataReceived, onDisconnected) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase().trim();
        this.onConnected = onConnected;
        this.onDataReceived = onDataReceived;
        this.onDisconnected = onDisconnected;

        await this.initSupabase();

        this.channel = this.supabase.channel('fastrack-' + this.roomCode, {
            config: {
                broadcast: { self: false }
            }
        });

        // Listen for game data
        this.channel.on('broadcast', { event: 'game' }, (payload) => {
            if (payload.payload.senderId !== this.playerId && this.onDataReceived) {
                this.onDataReceived(payload.payload.data);
            }
        });

        // Listen for host confirmation
        this.channel.on('broadcast', { event: 'confirmed' }, (payload) => {
            if (payload.payload.senderId !== this.playerId) {
                console.log('Host confirmed connection!');
                this.connected = true;
                if (this.onConnected) this.onConnected();
            }
        });

        // Listen for player leave
        this.channel.on('broadcast', { event: 'leave' }, (payload) => {
            if (payload.payload.senderId !== this.playerId) {
                this.connected = false;
                if (this.onDisconnected) this.onDisconnected('Opponent disconnected');
            }
        });

        // Subscribe then announce join
        const status = await this.channel.subscribe();
        console.log('Joiner channel status:', status);

        // Announce that we joined
        await this.channel.send({
            type: 'broadcast',
            event: 'join',
            payload: { senderId: this.playerId }
        });

        // Timeout if host doesn't confirm
        setTimeout(() => {
            if (!this.connected) {
                if (this.onDisconnected) {
                    this.onDisconnected('Room not found or host not responding. Check the code and try again.');
                }
            }
        }, 10000);
    }

    send(data) {
        if (this.channel) {
            this.channel.send({
                type: 'broadcast',
                event: 'game',
                payload: { senderId: this.playerId, data }
            });
        }
    }

    disconnect() {
        if (this.channel) {
            this.channel.send({
                type: 'broadcast',
                event: 'leave',
                payload: { senderId: this.playerId }
            });
            this.supabase.removeChannel(this.channel);
            this.channel = null;
        }
        this.connected = false;
        this.roomCode = null;
    }
}

const network = new NetworkManager();
