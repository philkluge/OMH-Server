const WebSocket = require("ws");
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();

wss.on("connection", (ws) => {
    let currentRoom = null;

    ws.on("message", (raw) => {
        try {
            const msg = JSON.parse(raw);

            if (msg.type === "join") {
                currentRoom = msg.room;
                if (!rooms.has(currentRoom))
                    rooms.set(currentRoom, new Set());
                rooms.get(currentRoom).add(ws);
                console.log(`Client joined room: ${currentRoom} (${rooms.get(currentRoom).size} total)`);
                return;
            }

            if (currentRoom && rooms.has(currentRoom)) {
                const data = JSON.stringify(msg);
                rooms.get(currentRoom).forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN)
                        client.send(data);
                });
            }
        } catch (e) {
            console.error("Invalid message:", e);
        }
    });

    ws.on("close", () => {
        if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom).delete(ws);
            if (rooms.get(currentRoom).size === 0)
                rooms.delete(currentRoom);
            console.log(`Client left room: ${currentRoom}`);
        }
    });
});

console.log(`Relay server running on port ${PORT}`);
