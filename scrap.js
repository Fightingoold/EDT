const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Diagnostic MMIDASH-BOT (Mode Bypass Proceed)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR,fr'] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion à l'ENT...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#username', { timeout: 15000 });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // --- NOUVEAU : BYPASS DES BOUTONS INTERMÉDIAIRES ---
        console.log("⏳ Vérification des boutons Proceed/Continuer...");
        await new Promise(r => setTimeout(r, 5000)); // On laisse la page se poser

        await page.evaluate(() => {
            const labels = ["PROCEED", "CONTINUER", "CONTINUE", "ACCÉDER", "ACCEDER"];
            const elements = Array.from(document.querySelectorAll('button, span, a, input[type="button"]'));
            const target = elements.find(el => labels.some(l => el.innerText.toUpperCase().includes(l)));
            if (target) {
                console.log("Bouton trouvé, clic en cours...");
                target.click();
            }
        });

        // Attente après le clic sur Proceed
        await new Promise(r => setTimeout(r, 8000)); 

        const etapes = [
            ["Etudiants", "Students"],
            ["IUT LAVAL", "IUT LAVAL"],
            ["Dpt MMI", "Dpt MMI"],
            ["BUT MMI1", "BUT MMI1"],
            ["TD11", "TD11"],
            ["11B", "11B"]
        ];
        
        for (const [fr, en] of etapes) {
            console.log(`📍 Étape : ${fr} / ${en}`);
            
            try {
                await page.waitForFunction(
                    (f, e) => {
                        const spans = Array.from(document.querySelectorAll('span'));
                        return spans.some(s => (s.innerText.trim() === f || s.innerText.trim() === e) && s.offsetHeight > 0);
                    },
                    { timeout: 20000 }, 
                    fr, en
                );
            } catch (e) {
                console.log(`📸 Blocage sur ${fr}, capture d'écran...`);
                await page.screenshot({ path: 'error.png', fullPage: true });
                throw new Error(`Échec à l'étape ${fr}. Vérifie error.png`);
            }

            const handle = await page.evaluateHandle((f, e) => {
                return Array.from(document.querySelectorAll('span'))
                            .find(s => s.innerText.trim() === f || s.innerText.trim() === e);
            }, fr, en);

            if (fr !== "11B") {
                await page.evaluate((f, e) => {
                    const span = Array.from(document.querySelectorAll('span'))
                                      .find(s => s.innerText.trim() === f || s.innerText.trim() === e);
                    const icon = span?.parentElement?.querySelector('.x-tree3-node-joint');
                    if (icon) icon.click();
                }, fr, en);
                await new Promise(r => setTimeout(r, 2500));
            } else {
                await handle.click({ clickCount: 2 });
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText')).filter(b => b.innerText.trim().length > 5).map(bloc => {
                const container = bloc.parentElement.parentElement;
                const left = parseInt(container.style.left) || 0;
                const lignes = bloc.innerText.split('\n').map(s => s.trim()).filter(s => s !== "");
                const horaireRaw = (bloc.innerText.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/) || [""])[0];
                return {
                    jour: joursSemaine[Math.round(left / 245)] || "Inconnu",
                    matiere: lignes[0] || "Cours",
                    horaire: horaireRaw.replace(/\s/g, '').replace('-', ' - '),
                    type: lignes.join(' ').toUpperCase().includes('TP') ? 'TP' : (lignes.join(' ').toUpperCase().includes('TD') ? 'TD' : 'PROMO'),
                    salle: lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C",
                    prof: lignes.length > 2 ? lignes[lignes.length - 1] : "N/C"
                };
            });
        });

        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ Extraction réussie !`);

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
        if (!fs.existsSync('error.png')) await page.screenshot({ path: 'error.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();