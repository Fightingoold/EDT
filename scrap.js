const puppeteer = require('puppeteer');

(async () => {
    console.log("🎬 TEST DE CONNEXION");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox'] 
    });
    const page = await browser.newPage();

    try {
        console.log("🔗 Navigation vers ADE...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        console.log("📸 Titre de la page :", await page.title());
        
        const loginPresent = await page.$('#username') !== null;
        console.log("❓ Champ login présent :", loginPresent);

        if (loginPresent) {
            await page.type('#username', process.env.ADE_USER); 
            await page.type('#password', process.env.ADE_PASS);
            console.log("⌨️ Identifiants saisis, clic sur connexion...");
            await Promise.all([
                page.click('#submitBtn'),
                page.waitForNavigation({ waitUntil: 'networkidle0' })
            ]);
        }

        console.log("📍 URL actuelle après login :", page.url());
        
        // On liste tous les boutons présents sur la page pour voir ce qui s'affiche
        const buttons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('span, button')).map(el => el.innerText).filter(t => t.length > 1);
        });
        console.log("🔘 Boutons détectés sur la page :", buttons.join(' | '));

    } catch (error) {
        console.error("💥 ERREUR DIRECTE :", error.message);
    } finally {
        await browser.close();
        console.log("👋 Fin du test.");
    }
})();