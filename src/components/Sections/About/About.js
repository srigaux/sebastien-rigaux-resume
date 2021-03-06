import React from 'react';
import Logo from '../../../assets/img/logo.inline.svg';
import SocialLinks from './SocialLinks';
import { Fade } from 'react-reveal';

function calculateAge(from) {
  const fromDate = new Date(from);
  const ageDifMs = Date.now() - fromDate.getTime();
  const ageDate = new Date(ageDifMs); // miliseconds from epoch
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

const About = ({ about, config }) => {
  const html = about.html;
  const birthdate = about.frontmatter.birthdate;
  const firstExperienceDate = about.frontmatter.firstExperienceDate;

  const age = calculateAge(birthdate);
  const experienceYears = calculateAge(firstExperienceDate);
  const hydratedHtml = html
    .replace('{{age}}', age)
    .replace('{{experienceYears}}', experienceYears);

  return (
    <section
      className="resume-section p-3 p-lg-5 d-flex align-items-center"
      id="about"
    >
      <div className="w-100">
        <div className="row">
          <Fade delay={0}>
            <div className="col-sm-3 d-lg-none ">
              <Logo
                className="img img-fluid fluid"
                style={{ maxHeight: '11rem' }}
              />
            </div>
          </Fade>
          <Fade delay={200}>
            <div className="col-sm-9 col-lg-8 col-xl-8 text-center text-sm-left">
              <h1 className="mb-0">
                {config.firstName}
                <br />
                {config.lastName}
              </h1>
              <div className="subheading mb-5">{config.label}</div>
            </div>
            <div className="offset-sm-3 offset-lg-0 col-lg-4 col-xl-4">
              <div className="subheading mb-5">
                {config.address.formatted} <br />
                {config.phone} <br />
                <a href={`mailto:${config.email}`}>{config.email}</a>
              </div>
            </div>
          </Fade>
        </div>

        <Fade delay={400}>
          <div className="row mb-5">
            <div className="col-lg-8 col-xl-9">
              <div
                className="lead"
                dangerouslySetInnerHTML={{ __html: hydratedHtml }}
              />
            </div>

            <div className="col-lg-4 col-xl-3 ml-5 ml-lg-0">
              <SocialLinks socialLinks={config.socialLinks} />
            </div>
          </div>
        </Fade>
      </div>
    </section>
  );
};

export default About;
