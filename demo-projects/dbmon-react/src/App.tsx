import { useState, useEffect } from "react";

declare var ENV: any;
declare var Monitoring: any;

function App() {
  const [databases, setDatabases] = useState<any[]>([]);

  useEffect(() => {
    function loadSamples() {
      setDatabases(ENV.generateData().toArray());
      Monitoring.renderRate.ping();
      setTimeout(loadSamples, 0);
    }

    loadSamples();
  }, []);

  return (
    <div>
      <table className="table table-striped latest-data">
        <tbody>
          {databases.map(function (database) {
            return (
              <tr key={database.dbname}>
                <td className="dbname">{database.dbname}</td>
                <td className="query-count">
                  <span className={database.lastSample.countClassName}>
                    {database.lastSample.nbQueries}
                  </span>
                </td>
                {database.lastSample.topFiveQueries.map(function (
                  query: any,
                  _index: number,
                ) {
                  return (
                    <td
                      className={"Query " + query.elapsedClassName}
                      key={`${database.dbname}-${query.id}`}
                    >
                      {query.formatElapsed}
                      <div className="popover left">
                        <div className="popover-content">{query.query}</div>
                        <div className="arrow" />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;
