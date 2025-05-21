import dotenv from "dotenv";
import express from "express";
import fileUpload from "express-fileupload";
import cookieParser from "cookie-parser";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import simpleGit from "simple-git";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

app.use(cookieParser());
app.use(fileUpload());
app.use(express.static(__dirname));

// GitHub Login
app.get("/login", (req, res) => {
  const redirect_uri = `${process.env.BASE_URL}/callback`;

  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirect_uri}&scope=repo`
  );
});

// GitHub OAuth Callback
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  try {
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } }
    );
    const token = tokenRes.data.access_token;
    res.cookie("token", token);
    res.redirect("/");
  } catch (error) {
    console.error("❌ Error during GitHub OAuth:", error);
    res.status(500).send("Authentication failed");
  }
});

// Get User Info
app.get("/me", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({});
  try {
    const userRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${token}` },
    });
    res.json({ login: userRes.data.login });
  } catch (error) {
    console.error("❌ Error fetching user info:", error);
    res.json({});
  }
});

// Handle File Upload and Deploy
app.post("/upload", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).send("Unauthorized");

  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  const files = req.files.files;
  const repoName = `deployhub-${Date.now()}`;
  const repoPath = path.join(__dirname, repoName);

  try {
    const repoRes = await axios.post(
      "https://api.github.com/user/repos",
      { name: repoName },
      { headers: { Authorization: `token ${token}` } }
    );

    fs.mkdirSync(repoPath, { recursive: true });
    const saveFile = async (file) => {
      const filePath = path.join(repoPath, file.name);
      await new Promise((resolve, reject) => {
        file.mv(filePath, (err) => (err ? reject(err) : resolve()));
      });
    };

    if (Array.isArray(files)) {
      for (const file of files) await saveFile(file);
    } else {
      await saveFile(files);
    }

    const git = simpleGit(repoPath);
    await git.init();
    await git.checkoutLocalBranch("main");
    await git.addRemote("origin", repoRes.data.clone_url);
    await git.add(".");
    await git.commit("Initial commit");
    await git.push("origin", "main");

    await axios.post(
      `https://api.github.com/repos/${repoRes.data.owner.login}/${repoName}/pages`,
      { source: { branch: "main", path: "/" } },
      { headers: { Authorization: `token ${token}` } }
    );

    const pagesUrl = `https://${repoRes.data.owner.login}.github.io/${repoName}/`;
    res.json({ url: pagesUrl });
  } catch (error) {
    console.error("❌ Error during upload:", error.response?.data || error.message);
    res.status(500).send("Failed to upload files");
  } finally {
    setTimeout(() => {
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
        console.log("🧹 Temporary files cleaned up");
      } catch (err) {
        console.error("❌ Error cleaning temp files:", err);
      }
    }, 1000);
  }
});

// Logout
app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`✅ DeployHub พร้อมใช้งานที่: http://localhost:${PORT}`);
});
