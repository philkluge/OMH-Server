const WebSocket = require("ws");
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();

function leaveRoom(ws, roomName) 
{
    if (roomName && rooms.has(roomName)) 
    {
        const clients = rooms.get(roomName);
        clients.delete(ws);
        if (clients.size === 0) rooms.delete(roomName);
    }
}

wss.on("connection", (ws) => 
{
    let currentRoom = null;
    ws.isAlive = true;

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", (raw) => 
    {
        try 
        {
            const msg = JSON.parse(raw);

            if (msg.type === "join") 
            {
                if (currentRoom) leaveRoom(ws, currentRoom);
                
                currentRoom = msg.room;
                if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Set());
                
                rooms.get(currentRoom).add(ws);
                console.log(`joined: ${currentRoom} (${rooms.get(currentRoom).size} total)`);
                return;
            }

            if (currentRoom && rooms.has(currentRoom)) 
            {
                const data = JSON.stringify(msg);
                rooms.get(currentRoom).forEach((client) => 
                {
                    if (client !== ws && client.readyState === WebSocket.OPEN)
                        client.send(data, (err) =>
                            {
                                if (err) console.error("Error:", err)
                            });
                });
            }
        } catch (e) {
            console.error("Invalid JSON:", e);
        }
    });

    ws.on("close", () => 
    {
        leaveRoom(ws, currentRoom);
        console.log(`Client left room: ${currentRoom}`);
    });
});

const interval = setInterval(() => 
{
    wss.clients.forEach((ws) => 
    {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
},
30000);

wss.on("close", () => clearInterval(interval));
console.log(`Relay server running on port ${PORT}`);
