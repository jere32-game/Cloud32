const WebSocket = require('ws');
// Render asigna el puerto automáticamente
const PORT = process.env.PORT || 3000; 
const wss = new WebSocket.Server({ port: PORT });

console.log(`Cloud32 V2 Server iniciado en el puerto ${PORT}`);

wss.on('connection', (ws) => {
    // Cuando entra un nuevo mensaje de un jugador...
    ws.on('message', (message) => {
        const data = message.toString();
        // ...lo retransmite a todos los demás jugadores conectados
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    });

    ws.on('close', () => {
        console.log('Un cliente se ha desconectado');
    });
});
