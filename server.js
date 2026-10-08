const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

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


// ================================
// БАЗА ДАННЫХ
// ================================

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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                token TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("✅ Таблицы players и sessions готовы.");

    } catch (error) {

        console.error("❌ Ошибка создания таблиц:");
        console.error(error.message);

    }
}


// ================================
// ПАРОЛИ
// ================================

function hashPassword(password) {

    return new Promise((resolve, reject) => {

        const salt = crypto.randomBytes(16).toString("hex");

        crypto.scrypt(password, salt, 64, (error, derivedKey) => {

            if (error) {
                reject(error);
                return;
            }

            resolve(
                salt + ":" + derivedKey.toString("hex")
            );

        });

    });
}


function verifyPassword(password, storedHash) {

    return new Promise((resolve, reject) => {

        const parts = storedHash.split(":");

        if (parts.length !== 2) {
            resolve(false);
            return;
        }

        const salt = parts[0];
        const storedKey = Buffer.from(parts[1], "hex");

        crypto.scrypt(password, salt, 64, (error, derivedKey) => {

            if (error) {
                reject(error);
                return;
            }

            if (storedKey.length !== derivedKey.length) {
                resolve(false);
                return;
            }

            resolve(
                crypto.timingSafeEqual(storedKey, derivedKey)
            );

        });

    });
}


// ================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ================================

function readRequestBody(req) {

    return new Promise((resolve, reject) => {

        let body = "";

        req.on("data", chunk => {

            body += chunk;

            if (body.length > 10000) {
                req.destroy();
                reject(new Error("Слишком большой запрос"));
            }

        });

        req.on("end", () => {
            resolve(body);
        });

        req.on("error", reject);

    });

}


function sendJson(res, statusCode, data) {

    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify(data));

}


function parseCookies(req) {

    const cookies = {};

    const header = req.headers.cookie;

    if (!header) {
        return cookies;
    }

    header.split(";").forEach(cookie => {

        const parts = cookie.trim().split("=");

        const name = parts.shift();
        const value = parts.join("=");

        if (name) {
            cookies[name] = decodeURIComponent(value || "");
        }

    });

    return cookies;

}


function createSessionCookie(token) {

    return [
        "session=" + encodeURIComponent(token),
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        "Max-Age=2592000"
    ].join("; ");

}


function publicPlayer(player) {

    return {
        id: player.id,
        username: player.username,
        level: player.level,
        xp: player.xp,
        gold: player.gold,
        diamonds: player.diamonds,
        energy: player.energy,
        energy_time: player.energy_time
    };

}


// ================================
// РЕГИСТРАЦИЯ
// ================================

async function register(req, res) {

    if (!pool) {

        sendJson(res, 500, {
            success: false,
            message: "База данных недоступна."
        });

        return;
    }

    try {

        const bodyText = await readRequestBody(req);

        let body;

        try {
            body = JSON.parse(bodyText);
        } catch {
            sendJson(res, 400, {
                success: false,
                message: "Неверный формат запроса."
            });
            return;
        }

        const username = String(body.username || "").trim();
        const password = String(body.password || "");

        if (username.length < 3 || username.length > 50) {

            sendJson(res, 400, {
                success: false,
                message: "Логин должен быть от 3 до 50 символов."
            });

            return;
        }

        if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]+$/.test(username)) {

            sendJson(res, 400, {
                success: false,
                message: "В логине разрешены только буквы, цифры и _."
            });

            return;
        }

        if (password.length < 6 || password.length > 100) {

            sendJson(res, 400, {
                success: false,
                message: "Пароль должен быть от 6 до 100 символов."
            });

            return;
        }

        const existingPlayer = await pool.query(
            "SELECT id FROM players WHERE LOWER(username) = LOWER($1)",
            [username]
        );

        if (existingPlayer.rows.length > 0) {

            sendJson(res, 409, {
                success: false,
                message: "Такой логин уже существует."
            });

            return;
        }

        const passwordHash = await hashPassword(password);

        const result = await pool.query(
            `
            INSERT INTO players
            (username, password_hash, level, xp, gold, diamonds, energy, energy_time)
            VALUES ($1, $2, 1, 0, 1250, 100, 10, $3)
            RETURNING *
            `,
            [
                username,
                passwordHash,
                Date.now()
            ]
        );

        const player = result.rows[0];

        const token = crypto.randomBytes(32).toString("hex");

        await pool.query(
            `
            INSERT INTO sessions (player_id, token)
            VALUES ($1, $2)
            `,
            [player.id, token]
        );

        res.setHeader(
            "Set-Cookie",
            createSessionCookie(token)
        );

        sendJson(res, 201, {
            success: true,
            message: "Аккаунт создан.",
            player: publicPlayer(player)
        });

    } catch (error) {

        console.error("❌ Ошибка регистрации:");
        console.error(error);

        sendJson(res, 500, {
            success: false,
            message: "Ошибка сервера."
        });

    }

}


// ================================
// ВХОД
// ================================

async function login(req, res) {

    if (!pool) {

        sendJson(res, 500, {
            success: false,
            message: "База данных недоступна."
        });

        return;
    }

    try {

        const bodyText = await readRequestBody(req);

        let body;

        try {
            body = JSON.parse(bodyText);
        } catch {
            sendJson(res, 400, {
                success: false,
                message: "Неверный формат запроса."
            });
            return;
        }

        const username = String(body.username || "").trim();
        const password = String(body.password || "");

        const result = await pool.query(
            `
            SELECT *
            FROM players
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username]
        );

        if (result.rows.length === 0) {

            sendJson(res, 401, {
                success: false,
                message: "Неверный логин или пароль."
            });

            return;
        }

        const player = result.rows[0];

        const passwordCorrect = await verifyPassword(
            password,
            player.password_hash
        );

        if (!passwordCorrect) {

            sendJson(res, 401, {
                success: false,
                message: "Неверный логин или пароль."
            });

            return;
        }

        const token = crypto.randomBytes(32).toString("hex");

        await pool.query(
            `
            INSERT INTO sessions (player_id, token)
            VALUES ($1, $2)
            `,
            [player.id, token]
        );

        res.setHeader(
            "Set-Cookie",
            createSessionCookie(token)
        );

        sendJson(res, 200, {
            success: true,
            message: "Вход выполнен.",
            player: publicPlayer(player)
        });

    } catch (error) {

        console.error("❌ Ошибка входа:");
        console.error(error);

        sendJson(res, 500, {
            success: false,
            message: "Ошибка сервера."
        });

    }

}


// ================================
// ТЕКУЩИЙ ИГРОК
// ================================

async function getMe(req, res) {

    if (!pool) {

        sendJson(res, 500, {
            success: false,
            message: "База данных недоступна."
        });

        return;
    }

    try {

        const cookies = parseCookies(req);

        const token = cookies.session;

        if (!token) {

            sendJson(res, 401, {
                success: false,
                message: "Пользователь не авторизован."
            });

            return;
        }

        const result = await pool.query(
            `
            SELECT players.*
            FROM players
            INNER JOIN sessions
                ON sessions.player_id = players.id
            WHERE sessions.token = $1
            LIMIT 1
            `,
            [token]
        );

        if (result.rows.length === 0) {

            sendJson(res, 401, {
                success: false,
                message: "Сессия недействительна."
            });

            return;
        }

        sendJson(res, 200, {
            success: true,
            player: publicPlayer(result.rows[0])
        });

    } catch (error) {

        console.error("❌ Ошибка получения игрока:");
        console.error(error);

        sendJson(res, 500, {
            success: false,
            message: "Ошибка сервера."
        });

    }

}


// ================================
// ВЫХОД
// ================================

async function logout(req, res) {

    if (!pool) {

        sendJson(res, 500, {
            success: false,
            message: "База данных недоступна."
        });

        return;
    }

    try {

        const cookies = parseCookies(req);
        const token = cookies.session;

        if (token) {

            await pool.query(
                "DELETE FROM sessions WHERE token = $1",
                [token]
            );

        }

        res.setHeader(
            "Set-Cookie",
            "session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
        );

        sendJson(res, 200, {
            success: true,
            message: "Выход выполнен."
        });

    } catch (error) {

        console.error("❌ Ошибка выхода:");
        console.error(error);

        sendJson(res, 500, {
            success: false,
            message: "Ошибка сервера."
        });

    }

}


// ================================
// INDEX.HTML
// ================================

function sendGame(req, res) {

    const filePath = path.join(
        __dirname,
        "public",
        "index.html"
    );

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


// ================================
// HTTP СЕРВЕР
// ================================

const server = http.createServer(async (req, res) => {

    try {

        if (req.method === "GET" &&
            (req.url === "/" || req.url === "/index.html")) {

            sendGame(req, res);
            return;
        }


        if (req.method === "POST" &&
            req.url === "/api/register") {

            await register(req, res);
            return;
        }


        if (req.method === "POST" &&
            req.url === "/api/login") {

            await login(req, res);
            return;
        }


        if (req.method === "GET" &&
            req.url === "/api/me") {

            await getMe(req, res);
            return;
        }


        if (req.method === "POST" &&
            req.url === "/api/logout") {

            await logout(req, res);
            return;
        }


        res.writeHead(404, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        res.end("Страница не найдена");

    } catch (error) {

        console.error("❌ Необработанная ошибка:");
        console.error(error);

        sendJson(res, 500, {
            success: false,
            message: "Внутренняя ошибка сервера."
        });

    }

});


// ================================
// ЗАПУСК
// ================================

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