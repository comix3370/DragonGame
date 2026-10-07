const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

const server = http.createServer((req, res) => {

    if (req.url === "/" || req.url === "/index.html") {

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

        return;
    }

    res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Страница не найдена");
});

server.listen(PORT, () => {

    console.log("=================================");
    console.log("🐉 Три Короны");
    console.log("⚔️ Игровой сервер запущен!");
    console.log("🌐 http://localhost:" + PORT);
    console.log("=================================");

});