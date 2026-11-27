const express = require('express');
const sql = require('mssql'); // <-- Cambiado para la nube
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const config = {
    server: 'LibreriaUniDB.mssql.somee.com',
    database: 'LibreriaUniDB',
    user: 'JosS_47_SQLLogin_1',
    password: 'Libreria2026!', // <-- Pon la contraseña que pusiste en Somee
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// LOGIN
app.post('/api/login', async (req, res) => {
    const { correo } = req.body;
    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('correo', sql.NVarChar, correo)
            .query('SELECT * FROM Usuarios WHERE CorreoGoogle = @correo');
        
        if (result.recordset.length > 0) {
            res.json({ ok: true, usuario: result.recordset[0] });
        } else {
            res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
        }
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/entrada', async (req, res) => {
    const { usuarioID, sucursalID, modoDemo } = req.body;
    try {
        const pool = await sql.connect(config);
        
        // 1. Obtener el horario oficial del empleado (como texto)
        const userResult = await pool.request()
            .input('id', sql.Int, usuarioID)
            .query("SELECT CONVERT(varchar, HoraEntrada, 108) AS HoraEntrada FROM Usuarios WHERE UsuarioID = @id");
        
        const horarioOficial = userResult.recordset[0].HoraEntrada;
        
        // 2. Calcular la hora límite (5 min de tolerancia)
        let horaLimiteStr = '08:05:00'; 
        if (typeof horarioOficial === 'string') {
            const [h, m] = horarioOficial.split(':');
            const horaLimite = new Date();
            horaLimite.setHours(parseInt(h), parseInt(m) + 5, 0); 
            horaLimiteStr = horaLimite.toTimeString().split(' ')[0];
        }

        // 3. Definir la hora del servidor (Simulada para la demo)
        let horaServidor;
        if (modoDemo) {
            if (typeof horarioOficial === 'string') {
                const [h, m] = horarioOficial.split(':');
                const horaSimulada = new Date();
                horaSimulada.setHours(parseInt(h) - 1, 45, 0); // Llega 1 hora y 15 min antes
                horaServidor = horaSimulada.toTimeString().split(' ')[0]; // Formato "HH:mm:ss"
            } else {
                horaServidor = '07:45:00'; // Respaldo por si falla
            }
        } else {
            const timeResult = await pool.request().query("SELECT FORMAT(GETDATE(), 'HH:mm:ss') as HoraActual");
            horaServidor = timeResult.recordset[0].HoraActual;
        }

        // Asegurarnos de que horaServidor sea SIEMPRE un string
        horaServidor = String(horaServidor);

        // 4. Evaluar tardanza
        const estadoEntrada = horaServidor > horaLimiteStr ? 'Tardanza' : 'Puntual';

        // 5. Guardar en SQL Server
        await pool.request()
            .input('usuarioID', sql.Int, usuarioID)
            .input('sucursalID', sql.Int, sucursalID)
            .input('hora', sql.VarChar, horaServidor) 
            .input('estado', sql.NVarChar, estadoEntrada)
            .query(`
                INSERT INTO Asistencias (UsuarioID, SucursalID, Fecha, HoraEntrada, EstadoEntrada)
                VALUES (@usuarioID, @sucursalID, CAST(GETDATE() AS DATE), CAST(@hora AS TIME), @estado)
            `);

        res.json({ ok: true, mensaje: 'Entrada registrada', hora: horaServidor, estado: estadoEntrada });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// REGISTRAR SALIDA
app.post('/api/salida', async (req, res) => {
    const { usuarioID, modoDemo } = req.body;
    try {
        const pool = await sql.connect(config);
        
        const userResult = await pool.request()
            .input('id', sql.Int, usuarioID)
            .query("SELECT CONVERT(varchar, HoraSalida, 108) AS HoraSalida FROM Usuarios WHERE UsuarioID = @id");
        const horarioOficial = userResult.recordset[0].HoraSalida;
        
        let horaServidor;
        if (modoDemo) {
            if (typeof horarioOficial === 'string') {
                const [h, m] = horarioOficial.split(':');
                const horaSimulada = new Date();
                horaSimulada.setHours(parseInt(h) + 1, 15, 0); // Sale 1 hora después
                horaServidor = horaSimulada.toTimeString().split(' ')[0];
            } else {
                horaServidor = '19:15:00';
            }
        } else {
            const timeResult = await pool.request().query("SELECT FORMAT(GETDATE(), 'HH:mm:ss') as HoraActual"); 
            horaServidor = timeResult.recordset[0].HoraActual;
        }

        // Asegurarnos de que horaServidor sea SIEMPRE un string
        horaServidor = String(horaServidor);

        const estadoSalida = horaServidor < horarioOficial ? 'Anticipada' : 'Normal';

        const result = await pool.request()
            .input('usuarioID', sql.Int, usuarioID)
            .input('hora', sql.VarChar, horaServidor) 
            .input('estado', sql.NVarChar, estadoSalida)
            .query(`
                UPDATE Asistencias 
                SET HoraSalida = CAST(@hora AS TIME), EstadoSalida = @estado
                WHERE UsuarioID = @usuarioID AND Fecha = CAST(GETDATE() AS DATE) AND HoraSalida IS NULL
            `);

        if (result.rowsAffected[0] > 0) {
            res.json({ ok: true, mensaje: 'Salida registrada', hora: horaServidor, estado: estadoSalida });
        } else {
            res.status(400).json({ ok: false, error: 'No hay entrada registrada hoy o ya marcaste salida.' });
        }
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// PANEL DE LA DUEÑA
app.get('/api/panel', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT A.AsistenciaID, U.NombreCompleto, S.Nombre AS Sucursal, 
                   CONVERT(varchar, A.HoraEntrada, 108) AS HoraEntrada, 
                   CONVERT(varchar, A.HoraSalida, 108) AS HoraSalida,
                   A.EstadoEntrada, A.EstadoSalida,
                   CONVERT(varchar, U.HoraEntrada, 108) AS HorarioOficialEntrada,
                   CONVERT(varchar, U.HoraSalida, 108) AS HorarioOficialSalida
            FROM Asistencias A
            JOIN Usuarios U ON A.UsuarioID = U.UsuarioID
            JOIN Sucursales S ON A.SucursalID = S.SucursalID
            WHERE A.Fecha = CAST(GETDATE() AS DATE)
            ORDER BY A.HoraEntrada DESC
        `);
        res.json({ ok: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.listen(3000, '0.0.0.0', () => console.log('Servidor en http://localhost:3000'));