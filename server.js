const WebSocket = require("ws");
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

class User 
{
    constructor(ws, username) 
    {
        this.ws = ws;
        this.username = username;
        this.isAlive = true;
        this.connectedAt = Date.now();
    }
}

class Room 
{
    constructor(roomCode) 
    {
        this.roomCode = roomCode;
        this.users = new Map();
        this.createdAt = Date.now();
    }

    addUser(ws, username) 
    {
        if (this.users.has(username)) 
        {
            return false;
        }
        this.users.set(username, new User(ws, username));
        return true;
    }

    removeUser(username) 
    {
        return this.users.delete(username);
    }

    getUserCount() 
    {
        return this.users.size;
    }

    getOtherUsers(excludeUsername) 
    {
        return Array.from(this.users.entries())
            .filter(([name]) => name !== excludeUsername)
            .map(([name, user]) => ({ username: name, connectedAt: user.connectedAt }));
    }

    broadcast(message, excludeUsername = null) 
    {
        const data = JSON.stringify(message);
        this.users.forEach((user, username) => 
        {
            if (excludeUsername && username === excludeUsername) 
            {
                return;
            }
            if (user.ws.readyState === WebSocket.OPEN) 
            {
                user.ws.send(data, (err) => 
                {
                    if (err) console.error(`[${this.roomCode}] Broadcast error to ${username}:`, err);
                });
            }
        });
    }

    isEmpty() 
    {
        return this.users.size === 0;
    }
}

const rooms = new Map();

function getRoomStats(roomCode) 
{
    const room = rooms.get(roomCode);
    if (!room) return null;
    return {
        roomCode,
        userCount: room.getUserCount(),
        createdAt: room.createdAt,
        users: Array.from(room.users.keys())
    };
}

wss.on("connection", (ws) => 
{
    let currentRoom = null;
    let currentUsername = null;

    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => 
    {
        try 
        {
            const msg = JSON.parse(raw);

            if (msg.type === "join") {
                const { roomCode, username } = msg;

                if (!roomCode || !username || typeof username !== "string") 
                {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Invalid roomCode or username"
                    }));
                    return;
                }

                if (currentRoom) 
                {
                    const room = rooms.get(currentRoom);
                    if (room && currentUsername) 
                    {
                        room.broadcast({
                            type: "user_left",
                            username: currentUsername,
                            userCount: room.getUserCount() - 1,
                            users: room.getOtherUsers(currentUsername)
                        });
                        room.removeUser(currentUsername);
                    }
                    if (room && room.isEmpty()) 
                    {
                        rooms.delete(currentRoom);
                        console.log(`[${currentRoom}] Room closed (empty)`);
                    }
                }

                if (!rooms.has(roomCode)) 
                {
                    rooms.set(roomCode, new Room(roomCode));
                    console.log(`[${roomCode}] New room created`);
                }

                const room = rooms.get(roomCode);
                const joined = room.addUser(ws, username);

                if (!joined) 
                {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: `Username "${username}" already taken in this room`
                    }));
                    return;
                }

                currentRoom = roomCode;
                currentUsername = username;

                ws.send(JSON.stringify({
                    type: "join_success",
                    roomCode,
                    username,
                    userCount: room.getUserCount(),
                    users: room.getOtherUsers(username)
                }));

                room.broadcast({
                    type: "user_joined",
                    username,
                    userCount: room.getUserCount(),
                    users: room.getOtherUsers(username)
                }, username);

                console.log(`[${roomCode}] ${username} joined (${room.getUserCount()} total)`);
                return;
            }

            if (msg.type === "message" && currentRoom && currentUsername) 
            {
                const room = rooms.get(currentRoom);
                if (room && room.users.has(currentUsername)) 
                {
                    room.broadcast({
                        type: "message",
                        username: currentUsername,
                        content: msg.content,
                        timestamp: Date.now(),
                        userCount: room.getUserCount()
                    });
                }
                return;
            }

            if (msg.type === "data" && currentRoom && currentUsername) 
            {
                const room = rooms.get(currentRoom);
                if (room && room.users.has(currentUsername)) 
                {
                    room.broadcast({
                        type: "data",
                        username: currentUsername,
                        data: msg.data,
                        timestamp: Date.now(),
                        userCount: room.getUserCount()
                    });
                }
                return;
            }

        } 
        catch (e) 
        {
            console.error("Invalid JSON:", e);
            ws.send(JSON.stringify({
                type: "error",
                message: "Invalid message format"
            }));
        }
    });

    ws.on("close", () => 
    {
        if (currentRoom && currentUsername) 
        {
            const room = rooms.get(currentRoom);
            if (room) {
                room.removeUser(currentUsername);

                if (!room.isEmpty()) 
                {
                    room.broadcast({
                        type: "user_left",
                        username: currentUsername,
                        userCount: room.getUserCount(),
                        users: room.getOtherUsers()
                    });
                } 
                else
                {
                    rooms.delete(currentRoom);
                    console.log(`[${currentRoom}] Room closed (empty)`);
                }

                console.log(`[${currentRoom}] ${currentUsername} disconnected`);
            }
        }
    });
});

const healthInterval = setInterval(() => 
{
    const now = Date.now();
    const timeout = 60000;

    wss.clients.forEach((ws) => 
    {
        if (ws.isAlive === false) 
        {
            ws.terminate();
            return;
        }

        ws.isAlive = false;
        ws.ping();
    });

    rooms.forEach((room, roomCode) => 
    {
        room.users.forEach((user, username) => 
        {
            if (user.ws.readyState !== WebSocket.OPEN) 
            {
                room.removeUser(username);

                if (!room.isEmpty()) 
                {
                    room.broadcast({
                        type: "user_left",
                        username,
                        userCount: room.getUserCount(),
                        users: room.getOtherUsers(),
                        reason: "timeout"
                    });
                } 
                else 
                {
                    rooms.delete(roomCode);
                    console.log(`[${roomCode}] Room closed (all users disconnected)`);
                }

                console.log(`[${roomCode}] ${username} removed (timeout/disconnect)`);
            }
        });
    });
}, 30000);

wss.on("close", () => 
{
    clearInterval(healthInterval);
});

process.on("SIGTERM", () => 
{
    console.log("SIGTERM received, shutting down...");
    clearInterval(healthInterval);
    wss.close();
    process.exit(0);
});

console.log(`Relay server running on port ${PORT}`);
