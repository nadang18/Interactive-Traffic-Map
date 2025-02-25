import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm'; 
// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Check that Mapbox GL JS is loaded
//console.log("Mapbox GL JS Loaded:", mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoibmFkYW5nMTgiLCJhIjoiY203anl6Z2I2MDdxdjJsb2Zzenc3Y3Q5aCJ9.roSnm0Nn1OPDEloW-BF0cg';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

// Helper function to convert coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);  // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point);  // Project to pixel coordinates
  return { cx: x, cy: y };  // Return as object for use in SVG attributes
}

// Helper function to format time
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Helper function to compute station traffic
function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips, 
    (v) => v.length, 
    (d) => d.start_station_id
  );

  // Compute arrivals
  const arrivals = d3.rollup(
    trips, 
    (v) => v.length, 
    (d) => d.end_station_id
  );

  // Update each station with the calculated values
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Helper function to convert date to minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Helper function to filter trips by time
function filterTripsByTime(trips, timeFilter) {
  return timeFilter === -1 
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        
        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
    });
}

// Wait for the map to load before adding data
map.on('load', async () => {
  // Add the Boston bike lanes data source
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  // Add the layer to visualize the Boston bike lanes
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'red',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Add the Cambridge bike lanes data source
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  // Add the layer to visualize the Cambridge bike lanes
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'red',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Fetch and parse the station data
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'; // Replace with the actual URL
    // Await JSON fetch
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData); // Log to verify structure

    let stations = jsonData.data.stations;
    console.log('Stations Array:', stations);

    // Fetch and parse the traffic data
    let trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      },
    );
    console.log('Loaded Traffic Data:', trips);

    // Compute initial station traffic
    stations = computeStationTraffic(stations, trips);
    console.log('Updated Stations Array:', stations);

    // Select the SVG element inside the map container
    const svg = d3.select('#map').select('svg');

    // Create a scale for the circle radius
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // Create a quantize scale for traffic flow
    const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

    // Append circles to the SVG for each station
    const circles = svg.selectAll('circle')
      .data(stations, (d) => d.short_name)  // Use station short_name as the key
      .enter()
      .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic)) // Radius based on traffic
      .attr('fill', 'steelblue')  // Circle fill color
      .attr('stroke', 'white')    // Circle border color
      .attr('stroke-width', 1)    // Circle border thickness
      .attr('opacity', 0.6)       // Circle opacity
      .attr('pointer-events', 'auto') // Enable pointer events for tooltips
      .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic)) // Set departure ratio
      .each(function(d) {
        // Add <title> for browser tooltips
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)  // Set the x-position using projected coordinates
        .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions);     // Update during map movement
    map.on('zoom', updatePositions);     // Update during zooming
    map.on('resize', updatePositions);   // Update on window resize
    map.on('moveend', updatePositions);  // Final adjustment after movement ends

    // Function to update the scatterplot based on the time filter
    function updateScatterPlot(timeFilter) {
      // Get only the trips that match the selected time filter
      const filteredTrips = filterTripsByTime(trips, timeFilter);
      
      // Recompute station traffic based on the filtered trips
      const filteredStations = computeStationTraffic(stations, filteredTrips);
      
      // Adjust the radius scale range based on the time filter
      timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

      // Update the scatterplot by adjusting the radius of circles
      circles
        .data(filteredStations, (d) => d.short_name)  // Ensure D3 tracks elements correctly
        .join('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
        .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic)); // Update departure ratio
    }

    // Handle the time filter slider
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    // Function to update the time display
    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value);  // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = '';  // Clear time display
        anyTimeLabel.style.display = 'block';  // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
        anyTimeLabel.style.display = 'none';  // Hide "(any time)"
      }

      // Call updateScatterPlot to reflect the changes on the map
      updateScatterPlot(timeFilter);
    }

    // Bind the slider's input event to the updateTimeDisplay function
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

  } catch (error) {
    console.error('Error loading JSON:', error); // Handle errors
  }
});

