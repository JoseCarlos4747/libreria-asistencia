const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const config = {
    server: 'LibreriaUniDB.mssql.somee.com',
    database: 'LibreriaUniDB',
    user: 'JosS_47_SQLLogin_1',
    password: 'Libreria2026!', // <-- TU CONTRASEÑA
    options: { encrypt: false, trustServerCertificate: true }
};

app.post('/api/registro', async (req, res) => {
    const { nombre, dni, correo, password, telefono, sucursalID, rol } = req.body;
    try {
        const pool = await sql.connect(config);
        const check = await pool.request().input('correo', sql.NVarChar, correo).query('SELECT * FROM Usuarios WHERE CorreoGoogle = @correo');
        if (check.recordset.length > 0) return res.status(400).json({ ok: false, error: 'Correo ya registrado.' });
        
        await pool.request()
            .input('nombre', sql.NVarChar, nombre).input('dni', sql.VarChar, dni).input('correo', sql.NVarChar, correo)
            .input('password', sql.NVarChar, password).input('telefono', sql.VarChar, telefono)
            .input('rol', sql.NVarChar, rol || 'Empleado').input('sucursalID', sql.Int, sucursalID ? parseInt(sucursalID) : null)
            .query(`INSERT INTO Usuarios (NombreCompleto, DNI, CorreoGoogle, Password, Telefono, Rol, SucursalID) VALUES (@nombre, @dni, @correo, @password, @telefono, @rol, @sucursalID)`);
        res.json({ ok: true, mensaje: 'Cuenta creada.' });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    const { correo, password } = req.body;
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().input('correo', sql.NVarChar, correo).input('password', sql.NVarChar, password)
            .query('SELECT * FROM Usuarios WHERE CorreoGoogle = @correo AND Password = @password');
        if (result.recordset.length > 0) res.json({ ok: true, usuario: result.recordset[0] });
        else res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/cambiar-password', async (req, res) => {
    const { correo, passwordActual, passwordNueva } = req.body;
    try {
        const pool = await sql.connect(config);
        const check = await pool.request().input('correo', sql.NVarChar, correo).input('pass', sql.NVarChar, passwordActual)
            .query('SELECT * FROM Usuarios WHERE CorreoGoogle = @correo AND Password = @pass');
        if (check.recordset.length === 0) return res.status(401).json({ ok: false, error: 'Contraseña actual incorrecta.' });
        
        await pool.request().input('correo', sql.NVarChar, correo).input('nueva', sql.NVarChar, passwordNueva)
            .query('UPDATE Usuarios SET Password = @nueva WHERE CorreoGoogle = @correo');
        res.json({ ok: true, mensaje: 'Contraseña actualizada.' });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ENTRADA CON VALIDACIÓN DE QR
app.post('/api/entrada', async (req, res) => {
    const { usuarioID, sucursalID, modoDemo, codigoQR } = req.body;
    try {
        const pool = await sql.connect(config);
        
        // Validar QR
                if (sucursalInfo.recordset.length > 0) {
            const qrOficial = sucursalInfo.recordset[0].CodigoQR;
            if (qrOficial && codigoQR !== qrOficial) {
                // ESTO ES TEMPORAL PARA VER QUÉ ESTÁ LEYENDO LA CÁMARA
                return res.status(400).json({ ok: false, error: `El QR dice: "${codigoQR}" pero se esperaba: "${qrOficial}"` });
            }
        }

        const userResult = await pool.request().input('id', sql.Int, usuarioID).query("SELECT CONVERT(varchar, HoraEntrada, 108) AS HoraEntrada FROM Usuarios WHERE UsuarioID = @id");
        const horarioOficial = userResult.recordset[0].HoraEntrada;
        let horaLimiteStr = '08:05:00'; 
        if (typeof horarioOficial === 'string') {
            const [h, m] = horarioOficial.split(':');
            const horaLimite = new Date(); horaLimite.setHours(parseInt(h), parseInt(m) + 5, 0); 
            horaLimiteStr = horaLimite.toTimeString().split(' ')[0];
        }

        let horaServidor;
        if (modoDemo) {
            const [h, m] = horarioOficial.split(':');
            const horaSimulada = new Date(); horaSimulada.setHours(parseInt(h) - 1, 45, 0); 
            horaServidor = horaSimulada.toTimeString().split(' ')[0];
        } else {
            const timeResult = await pool.request().query("SELECT FORMAT(GETDATE(), 'HH:mm:ss') as HoraActual");
            horaServidor = timeResult.recordset[0].HoraActual;
        }
        horaServidor = String(horaServidor);
        const estado = horaServidor > horaLimiteStr ? 'Tardanza' : 'Puntual';

        await pool.request()
            .input('u', sql.Int, usuarioID).input('s', sql.Int, sucursalID).input('h', sql.VarChar, horaServidor).input('e', sql.NVarChar, estado)
            .query(`INSERT INTO Asistencias (UsuarioID, SucursalID, Fecha, HoraEntrada, EstadoEntrada) VALUES (@u, @s, CAST(GETDATE() AS DATE), CAST(@h AS TIME), @e)`);

        res.json({ ok: true, mensaje: 'Entrada registrada', hora: horaServidor, estado });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// SALIDA CON VALIDACIÓN DE QR
app.post('/api/salida', async (req, res) => {
    const { usuarioID, sucursalID, modoDemo, codigoQR } = req.body;
    try {
        const pool = await sql.connect(config);
        
        const sucInfo = await pool.request().input('sucID', sql.Int, sucursalID).query('SELECT CodigoQR FROM Sucursales WHERE SucursalID = @sucID');
        if (sucInfo.recordset.length > 0 && sucInfo.recordset[0].CodigoQR && sucInfo.recordset[0].CodigoQR !== codigoQR) {
            return res.status(400).json({ ok: false, error: 'El QR no pertenece a tu tienda.' });
        }

        const userResult = await pool.request().input('id', sql.Int, usuarioID).query("SELECT CONVERT(varchar, HoraSalida, 108) AS HoraSalida FROM Usuarios WHERE UsuarioID = @id");
        const horarioOficial = userResult.recordset[0].HoraSalida;
        
        let horaServidor;
        if (modoDemo) {
            const [h, m] = horarioOficial.split(':');
            const horaSimulada = new Date(); horaSimulada.setHours(parseInt(h) + 1, 15, 0);
            horaServidor = horaSimulada.toTimeString().split(' ')[0];
        } else {
            const timeResult = await pool.request().query("SELECT FORMAT(GETDATE(), 'HH:mm:ss') as HoraActual"); 
            horaServidor = timeResult.recordset[0].HoraActual;
        }
        horaServidor = String(horaServidor);
        const estado = horaServidor < horarioOficial ? 'Anticipada' : 'Normal';

        const result = await pool.request()
            .input('u', sql.Int, usuarioID).input('h', sql.VarChar, horaServidor).input('e', sql.NVarChar, estado)
            .query(`UPDATE Asistencias SET HoraSalida = CAST(@h AS TIME), EstadoSalida = @e WHERE UsuarioID = @u AND Fecha = CAST(GETDATE() AS DATE) AND HoraSalida IS NULL`);

        if (result.rowsAffected[0] > 0) res.json({ ok: true, mensaje: 'Salida registrada', hora: horaServidor, estado });
        else res.status(400).json({ ok: false, error: 'No hay entrada hoy o ya marcaste salida.' });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/panel', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT A.AsistenciaID, U.NombreCompleto, S.Nombre AS Sucursal, 
                   CONVERT(varchar, A.HoraEntrada, 108) AS HoraEntrada, CONVERT(varchar, A.HoraSalida, 108) AS HoraSalida,
                   A.EstadoEntrada, A.EstadoSalida
            FROM Asistencias A
            JOIN Usuarios U ON A.UsuarioID = U.UsuarioID
            JOIN Sucursales S ON A.SucursalID = S.SucursalID
            WHERE A.Fecha = CAST(GETDATE() AS DATE) ORDER BY A.HoraEntrada DESC`);
        res.json({ ok: true, data: result.recordset });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Servidor en puerto ${port}`));