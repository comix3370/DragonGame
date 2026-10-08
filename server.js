const http = require("http");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

// Подключение к PostgreSQL.
// На Render DATABASE_URL уже будет доступна.
// На локальном компьютере её пока нет — это нормально.
let pool = null;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    console.log("🗄️ PostgreSQL подключение настроено.");
} else {
    console.log("ℹ️ DATABASE_URL не найдена. Локальный режим без базы данных.");
}


// Создание таблицы игроков
async function initDatabase() {

    if (!pool) {
        return;
    }

    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 1,
                xp INTEGER NOT NULL DEFAULT 0,
                gold INTEGER NOT NULL DEFAULT 1250,
                diamonds INTEGER NOT NULL DEFAULT 100,
                energy INTEGER NOT NULL DEFAULT 10,
                energy_time BIGINT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("✅ Таблица players готова.");

    } catch (error) {

        console.error("❌ Ошибка создания таблицы:");
        console.error(error.message);

    }
}


// Отправка index.html
function sendGame(req, res) {

    const filePath = path.join(__dirname, "public", "index.html");

    fs.readFile(filePath, (err, data) => {

        if (err) {

            res.writeHead(500, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("Ошибка загрузки игры");
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        res.end(data);

    });
}


// Игровой сервер
const server = http.createServer((req, res) => {

    if (req.url === "/" || req.url === "/index.html") {

        sendGame(req, res);
        return;

    }

    res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Страница не найдена");

});


// Запуск сервера
async function startServer() {

    await initDatabase();

    server.listen(PORT, () => {

        console.log("=================================");
        console.log("🐉 Эхо древних : начало");
        console.log("⚔️ Игровой сервер запущен!");
        console.log("🌐 http://localhost:" + PORT);
        console.log("=================================");

    });

}

startServer();