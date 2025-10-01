const express = require('express'),
    path = require('path'),
    fs = require('fs'),
    fsPromises = require('fs').promises,
    multer = require('multer'),
    { MongoClient } = require('mongodb'),
    cors = require('cors');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// AWS
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { error } = require('console');

require('dotenv').config();

// ESSENTIALS
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(cors());

// AWS VARIABLES
const bucketName = 'cinemage-bucket'; // more-image-uploads
const region = 'us-east-1';
const accessKey = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;

const client = new S3Client({
    credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretAccessKey,
    },
    region: region,
});

// MONGODB SETUP
const connectionUri =
    'mongodb+srv://micujonesii_db_user:qlPSyffyUYvbg3Jq@cinemagecluster.9r1ij0i.mongodb.net/?retryWrites=true&w=majority&appName=CinemageCluster';
const mongoClient = new MongoClient(connectionUri);
const dbName = 'cinemageDB';
let db, moviesCollection;
// Connect to the database when
// endpoints are accessed
async function run(query) {
    try {
        db = mongoClient.db(dbName);
        moviesCollection = db.collection('movies');
        console.log('Connected to MongoDB');

        return await query();
    } finally {
        await mongoClient.close();
    }
}

//
//
//
// S3 ENDPOINTS

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Get posters and thumbnails from S3 bucket
app.get('/images', async (req, res) => {
    let params = { Bucket: bucketName };

    // Get object names
    const listCommand = new ListObjectsV2Command(params);
    const listResponse = await client.send(listCommand);

    const keysToOmit = ['original-thumbnails/', 'resized-thumbnails/'];
    const filteredUrls = listResponse.Contents.filter(
        (object) => !keysToOmit.includes(object.Key)
    );

    const urlPromises = filteredUrls.map(async (object) => {
        // Get object data
        const objectCommand = new GetObjectCommand({
            ...params,
            Key: object.Key,
        });
        const objectResponse = await client.send(objectCommand);

        const url = await getSignedUrl(client, objectCommand, {
            expiresIn: 7200,
        });

        let caption; // replacing "key" with "caption" for client-size readability
        if (object.Key.includes('original-thumbnails/'))
            caption = object.Key.replace('original-thumbnails/', '');
        else if (object.Key.includes('resized-thumbnails/'))
            caption = object.Key.replace('resized-thumbnails/', '');

        return { url, caption: caption };
    });

    let objectUrls = await Promise.all(urlPromises);

    res.json({ urls: objectUrls });
});

// Send image files to S3 bucket
app.post('/upload', upload.single('image'), async (req, res) => {
    console.log('req.file', req.file);

    req.file.buffer;

    const params = {
        Bucket: bucketName,
        Key: `original-thumbnails/${req.file.originalname}`, // images
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ContentLength: req.file.size,
    };

    const command = new PutObjectCommand(params);
    await client.send(command);

    res.send({});
});

app.post('/upload/:imageUrl', async (req, res) => {
    const encodedUrl = req.params.imageUrl;
    const url = decodeURIComponent(encodedUrl);
    const title = req.body.title;
    const desiredFileName = `${title} poster`;
    const filePath = `./${desiredFileName}.jpeg`;

    try {
        // Download image locally
        const response = await fetch(url);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        fs.writeFileSync(filePath, buffer);

        // Upload to S3
        const params = {
            Bucket: bucketName,
            Key: `original-thumbnails/${desiredFileName}`,
            Body: buffer,
            ContentType: blob.type,
            ContentLength: blob.size,
        };
        const command = new PutObjectCommand(params);
        await client.send(command);

        fs.unlink(filePath, (err) => console.error(error));
    } catch (error) {
        console.error('Error uploading image to S3:', error);
    }
    res.send({});
});

//
//
//
//
// MONGO ENDPOINTS

// Get all movies
app.get('/movies', async (req, res) => {
    let movies;

    const q = async () => {
        movies = await moviesCollection.find().toArray();
        return movies;
    };

    try {
        movies = await run(q).catch(console.error);
        res.status(200).json(movies);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch movies' });
    }
});

// Get a movie object
app.get('/movies/:title', async (req, res) => {
    let movie;
    const title = req.params.title;
    const q = async () => {
        movie = await moviesCollection.findOne({ title: title });
    };

    try {
        run(q).catch(console.error);
        res.json(movie);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch movie' });
    }
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
