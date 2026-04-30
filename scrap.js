const puppeteer = require('puppeteer');
const fs = require('fs');
const ftp = require("basic-ftp");

(async () => {
    console.log("🎬 Tentative ultime...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion à ADE...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        // --- LOGIN ---
        await page.waitForSelector('#username');
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // --- ATTENTE ET CLIC SUR TOUS LES PROCEED ---
        console.log("🛡️ Passage de la sécurité (MFA/Proceed)...");
        await new Promise(r => setTimeout(r, 5000)); 

        // On essaie de cliquer sur tout ce qui ressemble à "PROCEED" ou "CONTINUE"
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('span, button, a'));
            elements.forEach(el => {
                const txt = el.innerText.toUpperCase();
                if (txt.includes('PROCEED') || txt.includes('CONTINUE') || txt.includes('CONTINUER')) {
                    el.click();
                }
            });
        });

        console.log("⏳ Attente de redirection vers le planning...");
        await new Promise(r => setTimeout(r, 10000)); 

        // --- NAVIGATION ARBORESCENCE ---
        console.log("📂 Recherche de 'Etudiants'...");
        
        // On essaie de cliquer sur "Etudiants" même si c'est caché
        const success = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span'));
            const target = spans.find(s => s.innerText.trim() === "Etudiants");
            if (target) {
                target.scrollIntoView();
                // On simule un double clic pour ouvrir
                const event = new MouseEvent('dblclick', { view: window, bubbles: true, cancelable: true });
                target.dispatchEvent(event);
                return true;
            }
            return false;
        });

        if (!success) throw new Error("Le mot 'Etudiants' est introuvable sur cette page.");

        console.log("✅ Dossier 'Etudiants' ouvert. On continue le chemin...");
        
        // On attend que le reste s'affiche (IUT LAVAL, etc.)
        await new Promise(r => setTimeout(r, 5000));

        // Note : On s'arrête ici pour tester si l'ouverture d'Etudiants fonctionne enfin
        console.log("📍 Test d'ouverture réussi !");

        // --- ENVOI D'UNE PHOTO POUR PREUVE ---
        await page.screenshot({ path: 'final_test.png' });
        const client = new ftp.Client();
        await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
        await client.uploadFrom("final_test.png", "public_html/final_test.png");
        client.close();
        
        console.log("📸 Regarde final_test.png sur ton site !");

    } catch (error) {
        console.error("❌ ERREUR FATALE :", error.message);
        // Screenshot de secours
        await page.screenshot({ path: 'error.png' });
        const client = new ftp.Client();
        try {
            await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
            await client.uploadFrom("error.png", "public_html/error.png");
        } catch(e) {}
        client.close();
    } finally {
        await browser.close();
    }
})();