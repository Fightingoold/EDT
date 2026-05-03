const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Scraping Final : Nettoyage strict (NOM PRENOM & Codes Ressources)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR,fr'] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#username', { timeout: 15000 });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([page.click('#submitBtn'), page.waitForNavigation({ waitUntil: 'networkidle0' })]);

        await new Promise(r => setTimeout(r, 6000));
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, span, a')).find(el => 
                ["PROCEED", "CONTINUER", "CONTINUE"].some(l => el.innerText.toUpperCase().includes(l))
            );
            if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 8000)); 

        // Navigation (Traisnees car tu as corrigé ça)
        const etapes = [["Etudiants", "Trainees"], ["IUT LAVAL", "IUT LAVAL"], ["Dpt MMI", "Dpt MMI"], ["BUT MMI1", "BUT MMI1"], ["TD11", "TD11"], ["11B", "11B"]];
        for (const [fr, en] of etapes) {
            await page.waitForFunction((f, e) => {
                const spans = Array.from(document.querySelectorAll('span'));
                return spans.some(s => (s.innerText.trim() === f || s.innerText.trim() === e) && s.offsetHeight > 0);
            }, { timeout: 20000 }, fr, en);
            const handle = await page.evaluateHandle((f, e) => {
                return Array.from(document.querySelectorAll('span')).find(s => s.innerText.trim() === f || s.innerText.trim() === e);
            }, fr, en);
            if (fr !== "11B") {
                await page.evaluate((f, e) => {
                    const span = Array.from(document.querySelectorAll('span')).find(s => s.innerText.trim() === f || s.innerText.trim() === e);
                    const icon = span?.parentElement?.querySelector('.x-tree3-node-joint');
                    if (icon) icon.click();
                }, fr, en);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                await handle.click({ clickCount: 2 });
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText')).map(bloc => {
                const container = bloc.parentElement.parentElement;
                const left = parseInt(container.style.left) || 0;
                let texte = bloc.innerText.trim();
                
                // 1. EXTRAIRE ET SUPPRIMER L'HORAIRE IMMÉDIATEMENT
                const horaireMatch = texte.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/);
                const horaire = horaireMatch ? horaireMatch[0].replace(/\s/g, '').replace('-', ' - ') : "N/C";
                texte = texte.replace(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/, ''); 

                const lignes = texte.split('\n').map(s => s.trim()).filter(s => s !== "");

                // 2. MATIÈRE : Regex stricte pour isoler le code (R ou SAE)
                let matiere = lignes[0] || "Cours";
                const codeMatiere = matiere.match(/(R\d\.\d+|SAE\d\.\d+)/i);
                if (codeMatiere) matiere = codeMatiere[0].toUpperCase();

                // 3. SALLE
                const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C";

                // 4. PROF : Nettoyage NOM PRENOM
                let prof = "N/C";
                const ligneProf = lignes.find(l => l !== salle && l !== lignes[0] && l.length > 2);
                if (ligneProf) {
                    // On retire les parenthèses, les chiffres et on passe en majuscules
                    prof = ligneProf.replace(/\(.*\)/g, '').replace(/\d+/g, '').trim().toUpperCase();
                }

                return {
                    jour: joursSemaine[Math.round(left / 245)] || "Inconnu",
                    matiere, horaire, 
                    type: texte.toUpperCase().includes('TP') ? 'TP' : (texte.toUpperCase().includes('TD') ? 'TD' : 'PROMO'),
                    salle, prof
                };
            }).filter(c => c.horaire !== "N/C" && c.matiere !== "Cours");
        });

        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ Planning généré : ${planningData.length} cours.`);

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();