// UI Manager - Screen transitions and user interactions
let currentScreen = 'home-screen';

function showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Show target screen
    setTimeout(() => {
        document.getElementById(screenId).classList.add('active');
        currentScreen = screenId;
    }, 10);
}

// Home Screen Handlers
document.getElementById('create-btn').addEventListener('click', async () => {
    // Create game and show lobby
    const roomCode = await network.createGame(
        onGameConnected,
        onGameDataReceived,
        onGameDisconnected
    );
    
    document.getElementById('room-code-display').textContent = roomCode;
    showScreen('lobby-screen');
});

document.getElementById('join-btn').addEventListener('click', () => {
    showScreen('join-screen');
    document.getElementById('room-code-input').value = '';
    document.getElementById('join-error').textContent = '';
});

// Join Screen Handlers
document.getElementById('join-submit-btn').addEventListener('click', async () => {
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
    
    if (roomCode.length !== 6) {
        document.getElementById('join-error').textContent = 'Room code must be 6 characters';
        return;
    }
    
    document.getElementById('join-error').textContent = 'Connecting...';
    
    await network.joinGame(
        roomCode,
        onGameConnected,
        onGameDataReceived,
        onGameDisconnected
    );
});

document.getElementById('join-back-btn').addEventListener('click', () => {
    showScreen('home-screen');
});

// Allow pressing Enter to join
document.getElementById('room-code-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('join-submit-btn').click();
    }
});

// Lobby Screen Handlers
document.getElementById('lobby-cancel-btn').addEventListener('click', () => {
    network.disconnect();
    showScreen('home-screen');
});

document.getElementById('copy-code-btn').addEventListener('click', () => {
    const roomCode = document.getElementById('room-code-display').textContent;
    
    // Try modern clipboard API
    if (navigator.clipboard) {
        navigator.clipboard.writeText(roomCode).then(() => {
            const btn = document.getElementById('copy-code-btn');
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = 'Copy Code';
            }, 2000);
        });
    } else {
        // Fallback for older browsers
        const input = document.createElement('input');
        input.value = roomCode;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        
        const btn = document.getElementById('copy-code-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = 'Copy Code';
        }, 2000);
    }
});

// Result Screen Handlers
document.getElementById('play-again-btn').addEventListener('click', () => {
    // Clean up current game
    game.cleanup();
    network.disconnect();
    
    // Return to home
    showScreen('home-screen');
});

document.getElementById('result-home-btn').addEventListener('click', () => {
    // Clean up current game
    game.cleanup();
    network.disconnect();
    
    // Return to home
    showScreen('home-screen');
});

// Network Event Handlers
function onGameConnected() {
    console.log('Game connected! Starting game...');
    
    // Start the game
    showScreen('game-screen');
    game.startGame(network.isHost);
}

function onGameDataReceived(data) {
    // Data is handled by the game engine
    // This is just a passthrough
}

function onGameDisconnected(reason) {
    console.log('Game disconnected:', reason);
    
    // Clean up
    game.cleanup();
    
    // Show error and return to home
    if (currentScreen === 'join-screen') {
        document.getElementById('join-error').textContent = reason || 'Failed to connect';
    } else if (currentScreen !== 'home-screen' && currentScreen !== 'result-screen') {
        alert(reason || 'Connection lost');
        showScreen('home-screen');
    }
}

// Handle page visibility changes (pause sync when hidden)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.gameStarted) {
        // Pause physics when tab is hidden
        if (game.runner) {
            Matter.Runner.stop(game.runner);
        }
    } else if (!document.hidden && game.gameStarted) {
        // Resume physics when tab is visible
        if (game.runner) {
            Matter.Runner.run(game.runner, game.engine);
        }
    }
});

// Prevent accidental page unload during game
window.addEventListener('beforeunload', (e) => {
    if (network.connected) {
        e.preventDefault();
        e.returnValue = 'You are in an active game. Are you sure you want to leave?';
        return e.returnValue;
    }
});

console.log('Fastrack game initialized!');
