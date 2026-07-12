const WebSocket = require('ws');
const PORT = process.env.PORT || 3000; 
const wss = new WebSocket.Server({ port: PORT });

// Aquí se guardarán todas las variables en la memoria del servidor
let cloudVars = {}; 

console.log(`Cloud32 V2 (Fluido) iniciado en el puerto ${PORT}`);

wss.on('connection', (ws) => {
    // 1. Sincronización instantánea: Al conectarse, el servidor le manda 
    // al jugador todo el estado actual de las variables de golpe.
    ws.send(JSON.stringify({ type: 'init', data: cloudVars }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            
            if (parsed.type === 'set') {
                // Actualiza la memoria del servidor
                cloudVars[parsed.name] = parsed.val;
                
                // Retransmite SOLO a los demás jugadores conectados (no al que lo envió)
                const outMsg = JSON.stringify(parsed);
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(outMsg);
                    }
                });
            }
        } catch (e) {
            // Ignorar mensajes malformados para evitar crasheos por spam
        }
    });

    ws.on('close', () => {
        // Lógica futura: Aquí podrías borrar las variables del jugador si se va
    });
});
