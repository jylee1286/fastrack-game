// UI Manager - Screen transitions and user interactions
let currentScreen = 'home-screen';
let helpShownThisSession = false;

function showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Show target screen
    setTimeout(() => {
        document.getElementById(screenId).classList.add('active');
        currentScreen = screenId;
        
        // Show help overlay on first game (if not shown this session)
        if (screenId === 'game-screen' && !helpShownThisSession) {
            setTimeout(() => {
                showHelp();
                helpShownThisSession = true;
            }, 500);
        }
    }, 10);
}

function showHelp() {
    document.getElementById('help-overlay').classList.add('active');
}

function hideHelp() {
    document.getElementById('help-overlay').classList.remove('active');
}

function updateConnectionStatus(status) {
    const dot = document.querySelector('.status-dot');
    if (!dot) return;
    
    dot.className = 'status-dot';
    if (status === 'connected') {
        dot.classList.add('status-connected');
    } else if (status === 'connecting') {
        dot.classList.add('status-connecting');
    } else {
        dot.classList.add('status-disconnected');
    }
}

// Home Screen Handlers
document.getElementById('create-btn').addEventListener('click', async () => {
    // Update connection status
    updateConnectionStatus('connecting');
    
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
    updateConnectionStatus('connecting');
    
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
    
    // Update connection status
    updateConnectionStatus('connected');
    
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
    
    // Update connection status
    updateConnectionStatus('disconnected');
    
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

// Help button handlers
document.getElementById('help-btn').addEventListener('click', () => {
    showHelp();
});

document.getElementById('help-close-btn').addEventListener('click', () => {
    hideHelp();
});

// Close help overlay when clicking outside
document.getElementById('help-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'help-overlay') {
        hideHelp();
    }
});

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
