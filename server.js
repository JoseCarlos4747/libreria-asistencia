const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuración de la base de datos en Somee (Nube)
const config = {
    server: 'LibreriaUniDB.mssql.somee.com',
    database: 'LibreriaUniDB',
    user: 'JosS_47_SQLLogin_1',
    password: 'Libreria2026!', // <-- Pon tu contraseña real de Somee si la cambiaste
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// ==========================================
// 1. AUTENTICACIÓN Y USUARIOS
// ==========================================

// Registro de usuario (6 campos)
app.post('/api/registro', async (req, res) => {
    const { nombre, dni, correo, password, telefono, sucursalID, rol } = req.body;
    try {
        const pool = await sql.connect(config);
        
        // Validar si el correo ya existe
        const check = await pool.request()
            .input('correo', sql.NVarChar, correo)
            .query('SELECT * FROM Usuarios WHERE CorreoGoogle = @correo');
            
        if (check.recordset.length > 0) {
            return res.status(400).json({ ok: false, error: 'Este correo ya está registrado.' });
        }

        const rolFinal = rol || 'Empleado';
        const sucursalFinal = sucursalID ? parseInt(sucursalID) : null;

        await pool.request()
            .input('nombre', sql.NVarChar, nombre)
            .input('dni', sql.VarChar, dni)
            .input('correo', sql.NVarChar, correo)
            .input('password', sql.NVarChar, password)
            .input('telefono', sql.VarChar, telefono)
            .input('rol', sql.NVarChar, rolFinal)
            .input('sucursalID', sql.Int, sucursalFinal)
            .query(`
                INSERT INTO Usuarios (NombreCompleto, DNI, CorreoGoogle, Password, Telefono, Rol, SucursalID)
                VALUES (@nombre, @dni, @correo, @password, @telefono, @rol, @sucursalID)
            `);

        res.json({ ok: true, mensaje: 'Cuenta creada exitosamente. Ya puedes iniciar sesión.' });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Login (Correo y Contraseña)
app.post('/api/login', async (req, res) => {
    const { correo, password } = req.body;
    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('correo', sql.NVarChar, correo)
            .input('password', sql.NVarChar, password)
            .query('SELECT * FROM Usuarios WHERE CorreoGoogle = @correo AND Password = @password');
        
        if (result.recordset.length > 0) {
            res.json({ ok: true, usuario: result.recordset[0] });
        } else {
            res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });
        }
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Cambiar Contraseña
app.post('/api/cambiar-password', async (req, res) => {
    const { correo, passwordActual, passwordNueva } = req.body;
    try {
        const pool = await sql.connect(config);
        
        const check = await pool.request()
            .input('correo', sql.NVarChar, correo)
            .input('passwordActual', sql.NVarChar, passwordActual)
            .query('SELECT * FROM Usuarios WHERE CorreoGoogle = @correo AND Password = @passwordActual');
            
        if (check.recordset.length === 0) {
            return res.status(401).json({ ok: false, error: 'La contraseña actual es incorrecta.' });
        }

        await pool.request()
            .input('correo', sql.NVarChar, correo)
            .input('passwordNueva', sql.NVarChar, passwordNueva)
            .query('UPDATE Usuarios SET Password = @passwordNueva WHERE CorreoGoogle = @correo');

        res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ==========================================
// 2. ASISTENCIAS (ENTRADA Y SALIDA)
// ==========================================

// Registrar Entrada
app.post('/api/entrada', async (req, res) => {
    const { usuarioID, sucursalID, modoDemo } = req.body;
    try {
        const pool = await sql.connect(config);
        
        const userResult = await pool.request()
            .input('id', sql.Int, usuarioID)
            .query("SELECT CONVERT(varchar, HoraEntrada, 108) AS HoraEntrada FROM Usuarios WHERE UsuarioID = @id");
        
        const horarioOficial = userResult.recordset[0].HoraEntrada;
        
        let horaLimiteStr = '08:05:00'; 
        if (typeof horarioOficial === 'string') {
            const [h, m] = horarioOficial.split(':');
            const horaLimite = new Date();
            horaLimite.setHours(parseInt(h), parseInt(m) + 5, 0); 
            horaLimiteStr = horaLimite.toTimeString().split(' ')[0];
        }

        let horaServidor;
        if (modoDemo) {
            if (typeof horarioOficial === 'string') {
                const [h, m] = horarioOficial.split(':');
                const horaSimulada = new Date();
                horaSimulada.setHours(parseInt(h) - 1, 45, 0); 
                horaServidor = horaSimulada.toTimeString().split(' ')[0];
            } else {
                horaServidor = '07:45:00';
            }
        } else {
            const timeResult = await pool.request().query("SELECT FORMAT(GETDATE(), 'HH:mm:ss') as HoraActual");
            horaServidor = timeResult.recordset[0].HoraActual;
        }

        horaServidor = String(horaServidor);
        const estadoEntrada = horaServidor > horaLimiteStr ? 'Tardanza' : 'Puntual';

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

// Registrar Salida
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
                horaSimulada.setHours(parseInt(h) + 1, 15, 0);
                horaServidor = horaSimulada.toTimeString().split(' ')[0];
            } else {
                horaServidor = '19:15:00';
            }
        } else {
            const timeResult = await pool.request().query("SELECT FORMAT(GETDATE(), 'HH:mm:ss') as HoraActual"); 
            horaServidor = timeResult.recordset[0].HoraActual;
        }

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

// ==========================================
// 3. PANEL DE LA DUEÑA
// ==========================================

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

// Iniciar Servidor
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Servidor en puerto ${port}`));