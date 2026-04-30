const puppeteer = require('puppeteer');
const fs = require('fs');
const ftp = require("basic-ftp");

(async () => {
    // Configuration pour GitHub Actions : on utilise le chemin de Chrome défini dans le .yml
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ] 
    });
    
    const page = await browser.newPage();

    try {
        console.log("🚀 Connexion au portail planning...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp');

        // --- ÉTAPE 1 : AUTHENTIFICATION ---
        await page.waitForSelector('#username', { visible: true });
        // Utilise les secrets de GitHub ou tes identifiants par défaut en local
        await page.type('#username', process.env.ADE_USER || 'i2402646'); 
        await page.type('#password', process.env.ADE_PASS || 'Dtu823hz');
        
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
        ]);

        // --- ÉTAPE 2 : NAVIGATION VERS TON GROUPE ---
        const continuerBtn = await page.waitForSelector('xpath///span[contains(., "Continuer")]');
        await continuerBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // Chemin pour le groupe 11B
        const chemin = ["Etudiants", "IUT LAVAL", "Dpt MMI", "BUT MMI1", "TD11", "11B"];
        for (let i = 0; i < chemin.length; i++) {
            const texte = chemin[i];
            const xpathIcone = `xpath///span[text()="${texte}"]/preceding-sibling::img[contains(@class, "x-tree3-node-joint")]`;
            try {
                const icone = await page.waitForSelector(xpathIcone, { visible: true, timeout: 5000 });
                if (i === chemin.length - 1) {
                    const finalNode = await page.waitForSelector(`xpath///span[text()="${texte}"]`);
                    await finalNode.click();
                } else {
                    await icone.click();
                }
                await new Promise(r => setTimeout(r, 2000)); 
            } catch (err) {
                const node = await page.waitForSelector(`xpath///span[text()="${texte}"]`);
                await node.click({ clickCount: 2 });
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // --- ÉTAPE 3 : EXTRACTION DES DONNÉES ---
        console.log("📊 Analyse du planning...");
        await new Promise(r => setTimeout(r, 5000)); 

        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            const blocs = Array.from(document.querySelectorAll('.eventText'))
                               .filter(b => b.innerText.trim().length > 1);
            
            return blocs.map(bloc => {
                const container = bloc.parentElement.parentElement;
                const leftValue = parseInt(container.style.left) || 0;
                const topValue = parseInt(container.style.top) || 0;

                const indexJour = Math.round(leftValue / 245);
                const jourLabel = joursSemaine[indexJour] || "Inconnu";

                const lignes = bloc.innerText.split('\n').map(s => s.trim()).filter(s => s !== "");
                const texteComplet = bloc.innerText;

                const ligneHoraireBrute = lignes.find(l => l.includes('h') && l.includes('-')) || "";
                const matchHoraire = ligneHoraireBrute.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/);
                const horairePropre = matchHoraire ? matchHoraire[0] : "N/C";

                const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "Inconnue";

                const matchCode = lignes[0].match(/(SAé\s*\d\.\d\d[a-z]?|R\d\.\d\d[a-z]?)/i);
                const matiereCode = matchCode ? matchCode[0].trim() : lignes[0];

                let typeCours = "Promo Entière";
                if (texteComplet.toUpperCase().includes("TP")) typeCours = "TP";
                else if (texteComplet.toUpperCase().includes("TD")) typeCours = "TD";

                const listeProfs = lignes.filter(l => {
                    const estMaj = l === l.toUpperCase();
                    const nEstPasGroupe = !/^(TD|TP|GRP|BUT|MMI|11B|11A)/i.test(l);
                    const nEstPasMatiere = !/^[R|S]\d\.\d\d/i.test(l);
                    const nEstPasSalle = l !== salle;
                    const nEstPasHoraire = !matchHoraire || !l.includes(matchHoraire[0]);
                    return estMaj && nEstPasGroupe && nEstPasMatiere && nEstPasSalle && nEstPasHoraire && l.length > 3;
                });

                return {
                    jour: jourLabel,
                    matiere: matiereCode,
                    type: typeCours,
                    salle: salle,
                    horaire: horairePropre,
                    prof: listeProfs.join(', ') || "AUTONOMIE",
                    _position: { x: leftValue, y: topValue }
                };
            })
            .filter((value, index, self) =>
                index === self.findIndex((t) => (
                    t._position.x === value._position.x && t._position.y === value._position.y
                ))
            );
        });

        // --- ÉTAPE 4 : TRI ET SAUVEGARDE LOCALE ---
        planningData.sort((a, b) => a._position.x - b._position.x || a._position.y - b._position.y);
        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log("✅ Fichier planning.json généré localement.");

        // --- ÉTAPE 5 : TRANSFERT FTP ---
        const client = new ftp.Client();
        try {
            console.log("📤 Connexion FTP en cours...");
            await client.access({
                host: process.env.FTP_HOST || "perso.univ-lemans.fr",
                user: process.env.FTP_USER || "i2402646",
                password: process.env.FTP_PASS || "Dtu823hz",
                secure: false
            });
            await client.uploadFrom("planning.json", "public_html/planning.json"); 
            console.log("🚀 Succès ! Le planning est en ligne.");
        } catch (ftpErr) {
            console.error("❌ Erreur FTP :", ftpErr.message);
        } finally {
            client.close();
        }

    } catch (error) {
        console.error("❌ ERREUR GLOBALE :", error);
    } finally {
        await browser.close();
        console.log("👋 Navigateur fermé.");
    }
})();