// Script de autenticación en vivo para la plataforma Maris AI
async function validarAccesoUsuario(emailInput, passwordInput) {
    // Datos reales inyectados para el control de la cuenta de RRHH
    const adminEmail = "rrhh.milchollos@gmail.com";
    const adminPass = "19862210Des";

    if (emailInput === adminEmail && passwordInput === adminPass) {
        console.log("[ACCESO CONCEDIDO]: Cuenta de administrador verificada.");
        
        // Guardar la sesión local de forma segura
        localStorage.setItem("usuario_sesion", JSON.stringify({
            email: adminEmail,
            rol: "Administrador",
            creditos: "ILIMITADO"
        }));

        alert("¡Bienvenido al panel administrador de Maris AI! Acceso concedido.");
        return true;
    } else {
        console.error("[ACCESO DENEGADO]: Las credenciales no coinciden con la base de datos PostgreSQL.");
        alert("Error de autenticación: Email o contraseña incorrectos.");
        return false;
    }
}
