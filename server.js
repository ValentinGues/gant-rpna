import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initialTasks } from './data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Serve static files from the current directory (for index.html, style.css, etc.)
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'database.json');

// Initialize database if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialTasks, null, 2));
}

let tasks = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));

function saveToDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(tasks, null, 2));
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send initial tasks to the newly connected client
    socket.emit('init_tasks', tasks);

    // When a user updates the tasks (add, drag&drop, delete)
    socket.on('update_tasks', (newTasks) => {
        tasks = newTasks;
        saveToDatabase();
        
        // Broadcast the updated tasks to all OTHER connected clients
        socket.broadcast.emit('tasks_updated', tasks);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    console.log(`To connect from another computer on the network, use http://<YOUR_LOCAL_IP>:${PORT}`);
});
