const express = require('express');
const sql = require('mssql/msnodesqlv8');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const config = {
    server: 'localhost',
    database: 'LibreriaUniAsistencia',
    driver: 'ODBC Driver 17 for SQL Server', // Asegúrate de que este sea el driver que usaste
    options: {
        trustedConnection: true,
        trustServerCertificate: true,
        encrypt: false
    }
};

// RUTA 1: Login (Simulado, buscando en tu tabla)
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

// RUTA 2: Registrar Entrada (Empleada)
app.post('/api/entrada', async (req, res) => {
    const { usuarioID, sucursalID } = req.body;
    try {
        const pool = await sql.connect(config);
        
        // Obtener la hora actual del servidor SQL (cumple RN-01)
        const timeResult = await pool.request().query("SELECT FORMAT(GETDATE(), 'HH:mm:ss') as HoraActual");
        const horaServidor = timeResult.recordset[0].HoraActual;

        // Regla de negocio: Tardanza si es después de las 08:05:00
        const estadoEntrada = horaServidor > '08:05:00' ? 'Tardanza' : 'Puntual';

        await pool.request()
            .input('usuarioID', sql.Int, usuarioID)
            .input('sucursalID', sql.Int, sucursalID)
            .input('hora', sql.Time, horaServidor)
            .input('estado', sql.NVarChar, estadoEntrada)
            .query(`
                INSERT INTO Asistencias (UsuarioID, SucursalID, Fecha, HoraEntrada, EstadoEntrada)
                VALUES (@usuarioID, @sucursalID, CAST(GETDATE() AS DATE), @hora, @estado)
            `);

        res.json({ ok: true, mensaje: 'Entrada registrada', hora: horaServidor, estado: estadoEntrada });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// RUTA 3: Panel de la Dueña (Ver asistencias del día)
app.get('/api/panel', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT A.AsistenciaID, U.NombreCompleto, S.Nombre AS Sucursal, 
                   FORMAT(A.HoraEntrada, 'hh:mm tt') AS Entrada, 
                   FORMAT(A.HoraSalida, 'hh:mm tt') AS Salida,
                   A.EstadoEntrada, A.EstadoSalida
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

app.listen(3000, () => console.log('Servidor en http://localhost:3000'));